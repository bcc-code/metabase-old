(ns metabase.data-access.validation
  "Checks that a sandbox is well-formed before it is saved: its question returns only columns of the sandboxed table
  (with compatible types), and every user attribute is remapped onto something the sandbox can filter on."
  (:require
   [clojure.string :as str]
   [metabase.data-access.db :as data-access.db]
   [metabase.lib-be.core :as lib-be]
   [metabase.lib.core :as lib]
   [metabase.lib.metadata :as lib.metadata]
   [metabase.lib.schema.parameter :as lib.schema.parameter]
   [metabase.query-processor.metadata :as qp.metadata]
   [metabase.request.core :as request]
   [metabase.util :as u]
   [metabase.util.i18n :refer [tru]]
   [metabase.util.malli.registry :as mr]))

(set! *warn-on-reflection* true)

(defn- bad-request [message data]
  (ex-info message (merge {:status-code 400} data)))

(defn- u-lower [s]
  (some-> s u/lower-case-en))

(defn field-for-column
  "The Field of `table-fields` a sandbox question's `column` stands for: the one with its ID, else the one with its
  name (exactly, then ignoring case, since native queries may change the case of column names)."
  [table-fields {col-id :id col-name :name}]
  (or (when col-id
        (some #(when (= (:id %) col-id) %) table-fields))
      (some #(when (= (:name %) col-name) %) table-fields)
      (when col-name
        (some #(when (= (u-lower (:name %)) (u-lower col-name)) %) table-fields))))

(defn- compatible-types?
  [col-type field-type]
  (or (nil? col-type)
      (nil? field-type)
      (isa? col-type field-type)
      (isa? field-type col-type)
      ;; drivers report numbers with whatever precision the query produced
      (and (isa? col-type :type/Number) (isa? field-type :type/Number))
      (and (isa? col-type :type/Temporal) (isa? field-type :type/Temporal))
      (and (isa? col-type :type/Text) (isa? field-type :type/Text))))

(defn column-field-mapping
  "Map each of `columns` (a sandbox question's returned columns) to the Field of `table-fields` it stands for, as
  `[[column field] ...]`. Throws a 400 when a column is not a column of the table, or when its type is incompatible
  with the Field's."
  [table-name table-fields columns]
  (vec
   (for [column columns
         :let   [field (field-for-column table-fields column)]]
     (do
       (when-not field
         (throw (bad-request (tru "Column \"{0}\" returned by the question is not a column of table \"{1}\". A row and column security question may only return columns of the table it restricts."
                                  (:name column) table-name)
                             {:column (:name column)})))
       (let [col-type   ((some-fn :effective-type :base-type) column)
             field-type ((some-fn :effective-type :base-type) field)]
         (when-not (compatible-types? col-type field-type)
           (throw (bad-request (tru "Column \"{0}\" returned by the question has type {1}, which is not compatible with type {2} of the table''s column."
                                    (:name column) (str col-type) (str field-type))
                               {:column (:name column)}))))
       [column field]))))

(defn query-columns
  "The columns `query` (of a sandbox question) returns. For a native query that's its saved result metadata when it
  has some; otherwise they are computed by the query processor as an admin. Throws a 400 when they can't be
  determined."
  [query]
  (let [saved   (when (lib/native-only-query? query)
                  (not-empty (get-in (lib/query-stage query -1) [:lib/stage-metadata :columns])))
        columns (or saved
                    (try
                      (request/as-admin (qp.metadata/result-metadata query))
                      (catch Throwable e
                        (throw (bad-request (tru "Could not determine the columns of the question: {0}" (ex-message e))
                                            {})))))]
    (when (empty? columns)
      (throw (bad-request (tru "Could not determine the columns of the question. Run and save the question, then try again.")
                          {})))
    columns))

(defn card-query
  "The query of `card` (Lib card metadata), with its saved result metadata attached. `overrides` (`:dataset_query`
  and/or `:result_metadata` of an edit not saved yet) take precedence."
  [mp card overrides]
  (lib/card->underlying-query mp (cond-> card
                                   (contains? overrides :dataset_query)
                                   (assoc :dataset-query (:dataset_query overrides)
                                          :result-metadata (:result_metadata overrides)))))

(defn card-columns
  "The columns the Card with `card-id` returns. Throws a 400 when they can't be determined."
  [mp card-id]
  (let [card (or (lib.metadata/card mp card-id)
                 (throw (bad-request (tru "Question {0} does not exist." card-id) {:card-id card-id})))]
    (query-columns (card-query mp card nil))))

(defn- template-tag-name [target]
  ;; [:variable [:template-tag "name"]] or [:dimension [:template-tag "name"]] (or {:id ...} tag refs)
  (let [[_tag [ref-type tag-name]] target]
    (when (= ref-type :template-tag)
      tag-name)))

(defn- field-ref [target]
  (let [[_tag [ref-type :as ref]] target]
    (when (= ref-type :field)
      ref)))

(defn- check-attribute-remappings!
  [table-fields card-query card-cols remappings]
  (doseq [[attribute target] remappings]
    (when (str/blank? attribute)
      (throw (bad-request (tru "A user attribute name must not be blank.") {})))
    (when-not (mr/validate ::lib.schema.parameter/target target)
      (throw (bad-request (tru "User attribute \"{0}\" is remapped onto an invalid target." attribute)
                          {:attribute attribute})))
    (let [tag-name  (template-tag-name target)
          [_ id-or-name opts :as field] (field-ref target)]
      (cond
        tag-name
        (let [tags (when (and card-query (lib/native-only-query? card-query))
                     (lib/template-tags card-query))]
          (when-not (some (fn [tag]
                            (or (= (:name tag) tag-name)
                                (and (map? tag-name) (= (:id tag) (:id tag-name)))))
                          (if (map? tags) (vals tags) tags))
            (throw (bad-request (tru "User attribute \"{0}\" is remapped onto a variable the question doesn''t have." attribute)
                                {:attribute attribute}))))

        field
        (let [candidates (if card-cols card-cols table-fields)
              found?     (if (integer? id-or-name)
                           (or (some #(= (:id %) id-or-name) candidates)
                               ;; a native question's column may stand for the table Field by name
                               (when-let [field-name (:name (some #(when (= (:id %) id-or-name) %) table-fields))]
                                 (some #(= (:name %) field-name) candidates)))
                           (some #(= (:name %) id-or-name) candidates))]
          (when (:join-alias opts)
            (throw (bad-request (tru "User attribute \"{0}\" must be remapped onto a column of the table or question." attribute)
                                {:attribute attribute})))
          (when-not found?
            (throw (bad-request (tru "User attribute \"{0}\" is remapped onto a column that isn''t in the table or question." attribute)
                                {:attribute attribute}))))

        :else
        (throw (bad-request (tru "User attribute \"{0}\" must be remapped onto a column or a variable." attribute)
                            {:attribute attribute}))))))

(defn check-sandbox!
  "Throws a 400 unless `sandbox` (with `:table_id`, and optional `:card_id` and `:attribute_remappings`) is valid:
  its question exists, uses the table's database and returns only columns of the table with compatible types, and
  its attribute remappings target columns or variables it has. `card-overrides` (`:dataset_query` and
  `:result_metadata`), when given, stand for an edit of the question that isn't saved yet."
  ([sandbox]
   (check-sandbox! sandbox nil))
  ([{:keys [table_id card_id attribute_remappings]} card-overrides]
   (let [{db-id :db_id table-name :name :as table} (or (data-access.db/table table_id)
                                                      (throw (bad-request (tru "Table {0} does not exist." table_id)
                                                                          {:table-id table_id})))
         mp           (lib-be/application-database-metadata-provider db-id)
         table-fields (lib.metadata/fields mp (:id table))
         card         (when card_id
                        (or (lib.metadata/card mp card_id)
                            (throw (bad-request (tru "Question {0} does not exist, or uses another database than the table." card_id)
                                                {:card-id card_id}))))
         card-query   (when card
                        (card-query mp card card-overrides))
         card-cols    (when card-query
                        (when-not (= db-id (lib/database-id card-query))
                          (throw (bad-request (tru "The question must use the same database as the table.")
                                              {:card-id card_id})))
                        (let [cols (query-columns card-query)]
                          (column-field-mapping table-name table-fields cols)
                          cols))]
     (check-attribute-remappings! table-fields card-query card-cols attribute_remappings)
     true)))
