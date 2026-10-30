(ns metabase.data-access.query-processor
  "Query processor middleware for row and column security (sandboxing) and blocked view-data access.

  ### How a sandbox is applied

  Every table a non-admin query reads (as a stage's `:source-table`, in joins, in the stages of saved questions it is
  built on) that is sandboxed for the current user is replaced by the sandbox's own query: the table filtered by the
  user's attribute values, or the sandbox question's query with the attribute values passed as parameters. That query
  is preprocessed on its own (as an admin, so it is not sandboxed again) and its stages are spliced in front of the
  stage that read the table. Each spliced stage carries `:query-permissions/sandboxed-table`, which the permission
  checks ([[metabase.query-permissions.core]]) read: the user needs query access to the sandboxed table, but not to
  whatever the sandbox question reads, nor read access to the sandbox question itself.

  A sandbox question may return fewer columns than the table has. The stage that read the table then may only refer to
  those columns: references to others are dropped from `:fields` and are an error anywhere else.

  The middleware runs twice ([[metabase.query-processor.preprocess]]): the second run catches the joins added after the
  first one (implicit joins, remapping joins). Stages that are already sandbox stages are never sandboxed again."
  (:require
   [metabase.analytics.settings :as analytics.settings]
   [metabase.api.common :as api]
   [metabase.data-access.sandbox :as data-access.sandbox]
   [metabase.data-access.validation :as data-access.validation]
   [metabase.lib.core :as lib]
   [metabase.lib.metadata :as lib.metadata]
   [metabase.lib.schema.parameter :as lib.schema.parameter]
   [metabase.permissions.core :as perms]
   [metabase.query-permissions.core :as query-perms]
   [metabase.query-processor.error-type :as qp.error-type]
   [metabase.request.core :as request]
   [metabase.util.i18n :refer [tru]]
   [metabase.util.malli.registry :as mr]
   [metabase.util.match :as match]))

(set! *warn-on-reflection* true)

;;; ------------------------------------------------- Sandbox stages -------------------------------------------------

(defn- sandbox-map? [x]
  (and (map? x) (some? (:query-permissions/sandboxed-table x))))

(defn- native-map? [x]
  (and (map? x) (some? (:native x))))

(defn- source-table-map? [x]
  (and (map? x) (pos-int? (:source-table x))))

(def ^:private stage-keys-not-carried-into-sandbox
  ;; Card provenance: the user doesn't need read access to the sandbox question or the questions it is built on.
  ;; Persisted-model substitution doesn't apply inside a sandbox either.
  [:qp/stage-is-from-source-card :qp/stage-had-source-card :source-query/model? :source-query/native-model?
   :persisted-info/native])

(defn- mark-sandbox-stages
  "Mark `stages` (and every stage of their joins) as sandbox stages for the Table with `table-id`."
  [table-id stages]
  (mapv (fn mark [stage]
          (cond-> (-> (apply dissoc stage stage-keys-not-carried-into-sandbox)
                      (assoc :query-permissions/sandboxed-table table-id))
            (seq (:joins stage))
            (update :joins (fn [joins]
                             (mapv (fn [join] (update join :stages #(mapv mark %))) joins)))))
        stages))

(defn- invalid-policy! [attribute]
  (throw (ex-info (tru "The row and column security policy for this table is invalid. Ask an administrator to fix it.")
                  {:type qp.error-type/bad-configuration, :attribute attribute})))

(defn- template-tag-target? [target]
  (let [[_ [ref-type]] target]
    (= ref-type :template-tag)))

(defn- field-target [target]
  (let [[tag [ref-type id-or-name]] target]
    (when (and (= tag :dimension) (= ref-type :field))
      id-or-name)))

(defn- attribute-filter
  "The filter clause keeping the rows of the last stage of `query` whose column `field-id-or-name` is `value` (or one of
  the values of a sequential `value`). The column is matched by Field ID, else by name; throws when it isn't there."
  [mp query attribute field-id-or-name value]
  (let [columns    (lib/filterable-columns query -1)
        field-name (if (integer? field-id-or-name)
                     (:name (lib.metadata/field mp field-id-or-name))
                     field-id-or-name)
        column     (or (when (integer? field-id-or-name)
                         (some #(when (= (:id %) field-id-or-name) %) columns))
                       (some #(when (= (:name %) field-name) %) columns))]
    (when-not column
      (invalid-policy! attribute))
    (apply lib/= column (if (sequential? value) value [value]))))

(defn- sandbox-source-query
  "The query that stands for the sandboxed table: the table or the sandbox question, keeping only the rows matching the
  current user's attribute values. Values for a question's variables are passed as parameters; a column is filtered
  explicitly, on top of the question (so it works for native questions too)."
  [mp {:keys [table_id card_id attribute_remappings] :as sandbox}]
  (let [values        (data-access.sandbox/sandbox-attribute-values sandbox)
        _             (doseq [[attribute target] attribute_remappings]
                        (when-not (and (mr/validate ::lib.schema.parameter/target target)
                                       (or (template-tag-target? target) (some? (field-target target))))
                          (invalid-policy! attribute)))
        tag-remaps    (filter (comp template-tag-target? val) attribute_remappings)
        field-remaps  (filter (comp some? field-target val) attribute_remappings)
        base          (if card_id
                        (cond-> (lib/card->underlying-query
                                 mp
                                 (or (lib.metadata/card mp card_id)
                                     (throw (ex-info (tru "The question used by row and column security for this table no longer exists.")
                                                     {:type qp.error-type/missing-required-permissions}))))
                          (seq field-remaps) lib/append-stage)
                        (lib/query mp (lib.metadata/table mp table_id)))
        filtered      (reduce (fn [query [attribute target]]
                                (lib/filter query -1 (attribute-filter mp query attribute (field-target target)
                                                                       (get values attribute))))
                              base
                              field-remaps)
        params        (vec (for [[attribute target] tag-remaps]
                             {:type   :category
                              :target target
                              :value  (let [value (get values attribute)]
                                        (if (sequential? value) (vec value) value))}))]
    (-> filtered
        (cond-> (seq params) (assoc :parameters params))
        ;; the sandbox stands for the whole table: no row limit, and remapping columns are the outer query's business
        (assoc-in [:middleware :disable-max-results?] true)
        (assoc-in [:middleware :disable-remaps?] true))))

(defn- preprocess-sandbox-query [query]
  (request/as-admin
    ((requiring-resolve 'metabase.query-processor.preprocess/preprocess) query)))

(def ^:private field-metadata-keys
  [:id :table-id :display-name :description :semantic-type :fk-target-field-id :visibility-type :has-field-values
   :settings :coercion-strategy])

(defn- with-table-field-metadata
  "A native sandbox question's columns only carry what the driver reported. Give each the metadata of the table Field it
  stands for, so results (and references to them by Field ID) look like the table's: display names, semantic types,
  foreign keys for drill-through."
  [mp table-id query]
  (let [stage (lib/query-stage query -1)]
    (if-not (and (= :mbql.stage/native (:lib/type stage))
                 (seq (get-in stage [:lib/stage-metadata :columns])))
      query
      (let [fields (lib.metadata/fields mp table-id)]
        (lib/update-query-stage
         query -1 update-in [:lib/stage-metadata :columns]
         (fn [columns]
           (mapv (fn [column]
                   (if-let [field (data-access.validation/field-for-column fields column)]
                     (merge column (select-keys field field-metadata-keys))
                     column))
                 columns)))))))

(defn- sandbox-stages
  "Preprocessed, marked stages of the query that stands for the Table with `table-id` under `sandbox`, and the columns
  they return."
  [mp table-id sandbox]
  (let [preprocessed (->> (sandbox-source-query mp sandbox)
                          preprocess-sandbox-query
                          (with-table-field-metadata mp table-id))]
    {:stages  (mark-sandbox-stages table-id (:stages preprocessed))
     :columns (lib/returned-columns preprocessed)}))

;;; ----------------------------------------------- Column restriction -----------------------------------------------

(defn- allowed-columns
  "When the sandbox drops columns of the table, `{:ids #{field-id} :names #{field-name}}` of the Fields of the table it
  keeps, and the Fields it drops. nil when every column is kept."
  [mp table-id sandbox-columns]
  (let [fields     (lib.metadata/fields mp table-id)
        col-ids    (into #{} (keep :id) sandbox-columns)
        col-names  (into #{} (keep :name) sandbox-columns)
        lower      #(some-> ^String % .toLowerCase)
        col-lnames (into #{} (map lower) col-names)
        kept?      (fn [{:keys [id name]}]
                     (or (contains? col-ids id)
                         (contains? col-names name)
                         (contains? col-lnames (lower name))))
        dropped    (remove kept? fields)]
    (when (seq dropped)
      (let [kept (filter kept? fields)]
        {:ids           (into #{} (map :id) kept)
         :names         (into #{} (map :name) kept)
         :dropped-ids   (into #{} (map :id) dropped)
         :dropped-names (into #{} (map :name) dropped)}))))

(defn- dropped-ref?
  "Whether `field-ref`, a reference made by the stage on top of a sandbox (or to a sandboxed join with `join-alias`),
  points at a column the sandbox dropped."
  [{:keys [dropped-ids dropped-names]} join-alias [_ opts id-or-name :as _field-ref]]
  (and (= (:join-alias opts) join-alias)
       (if (integer? id-or-name)
         (contains? dropped-ids id-or-name)
         (contains? dropped-names id-or-name))))

(defn- dropped-source-field?
  "Whether `field-ref` is an implicit join through a foreign key column the sandbox dropped."
  [{:keys [dropped-ids]} join-alias [_ opts _ :as _field-ref]]
  (and (nil? join-alias)
       (nil? (:source-field-join-alias opts))
       (contains? dropped-ids (:source-field opts))))

(defn- throw-dropped-column! [field-ref]
  (throw (ex-info (tru "You don''t have permission to see one of the columns this query uses.")
                  {:type      qp.error-type/missing-required-permissions
                   :field-ref field-ref})))

(defn- check-no-dropped-refs!
  "Throws if `form` refers to a column `restriction` drops, directly or through an implicit join."
  [restriction join-alias form]
  (match/match-many form
    [:field (_opts :guard map?) _id-or-name]
    (when (or (dropped-ref? restriction join-alias &match)
              (dropped-source-field? restriction join-alias &match))
      (throw-dropped-column! &match))))

(defn- remove-dropped-refs [restriction join-alias refs]
  (filterv #(not (dropped-ref? restriction join-alias %)) refs))

(defn- without-join-stages
  "`stage` without the stages of its joins, which are pipelines of their own; join conditions and fields stay."
  [stage]
  (cond-> stage
    (seq (:joins stage)) (update :joins (fn [joins] (mapv #(dissoc % :stages) joins)))))

(defn- restrict-stage
  "Apply `restriction` to the stage reading a column-restricted sandbox: drop dropped columns from `:fields`, throw when
  the rest of it refers to one."
  [restriction stage]
  (let [stage (cond-> stage
                (vector? (:fields stage))
                (update :fields #(remove-dropped-refs restriction nil %))

                (empty? (:fields stage))
                (dissoc :fields)

                (get-in stage [:lib/stage-metadata :columns])
                (update-in [:lib/stage-metadata :columns]
                           (fn [cols] (vec (remove #(contains? (:dropped-ids restriction) (:id %)) cols)))))]
    (check-no-dropped-refs! restriction nil (dissoc (without-join-stages stage) :lib/stage-metadata))
    stage))

;;; ------------------------------------------------- Walking stages -------------------------------------------------

(declare sandbox-pipeline)

(defn- empty-stage? [stage]
  (empty? (dissoc stage :lib/type :source-table :lib/stage-metadata)))

(defn- splice-sandbox
  "`stages` (a pipeline whose first stage reads the sandboxed Table with `table-id`) with the sandbox's stages spliced
  in front. Returns `{:stages ... :restriction ...}`."
  [mp table-id sandbox [first-stage & more]]
  (let [{sandbox-stages :stages, columns :columns} (sandbox-stages mp table-id sandbox)
        restriction (allowed-columns mp table-id columns)
        user-stages (if (and (empty-stage? first-stage) (empty? more))
                      []
                      (into [(cond->> (dissoc first-stage :source-table)
                               restriction (restrict-stage restriction))]
                            more))]
    {:stages      (into sandbox-stages user-stages)
     :restriction (when (empty? user-stages) restriction)}))

(defn- sandbox-joins
  "Sandbox the joins of `stage`. A join whose own pipeline ends up being just a column-restricting sandbox has its
  `:fields` pruned, and the rest of the stage is checked for references to the columns it drops."
  [mp stage]
  (if-not (seq (:joins stage))
    stage
    (let [results (mapv (fn [join]
                          (let [{:keys [stages restriction]} (sandbox-pipeline mp (:stages join))
                                join (assoc join :stages stages)]
                            [(cond-> join
                               (and restriction (vector? (:fields join)))
                               (update :fields #(remove-dropped-refs restriction (:alias join) %)))
                             (when restriction [(:alias join) restriction])]))
                        (:joins stage))
          stage   (assoc stage :joins (mapv first results))]
      (doseq [[join-alias restriction] (keep second results)]
        (check-no-dropped-refs! restriction join-alias
                                (update (without-join-stages stage) :joins
                                        (fn [joins] (mapv #(dissoc % :fields) joins)))))
      stage)))

(defn- sandbox-pipeline
  "Sandbox a pipeline of `stages` (a query's or a join's). Returns `{:stages ... :restriction ...}`, where
  `:restriction` is the column restriction of a pipeline that is nothing but a sandbox, for the caller to apply to
  references into it."
  [mp stages]
  (let [[sandbox-part user-part] (split-with :query-permissions/sandboxed-table stages)
        user-part                (mapv #(sandbox-joins mp %) user-part)]
    (if (seq sandbox-part)
      ;; already sandboxed (by the first run of this middleware): only joins added since then need attention
      {:stages (into (vec sandbox-part) user-part)}
      (let [table-id (:source-table (first user-part))
            sandbox  (when table-id
                       (data-access.sandbox/sandbox-for-table table-id))]
        (if sandbox
          (splice-sandbox mp table-id sandbox user-part)
          {:stages user-part})))))

(defn- query-tables-sandboxed? [query]
  (let [table-ids (into #{} (map :table_id) (data-access.sandbox/current-user-sandboxes))]
    (boolean (match/match-one (:stages query)
               {:source-table (_ :guard table-ids)} true))))

(defn apply-sandboxing
  "Pre-processing middleware. Replaces the tables a non-admin user queries that are sandboxed for them with their
  sandbox's query. See the namespace docstring."
  [query]
  (if (or (nil? api/*current-user-id*)
          api/*is-superuser?*
          (not (query-tables-sandboxed? query)))
    query
    (let [mp (lib/->metadata-provider query)]
      (assoc query :stages (:stages (sandbox-pipeline mp (:stages query)))))))

;;; ------------------------------------------------ Results metadata ------------------------------------------------

(defn- sandboxed-table-ids [query]
  (into #{}
        (map second)
        (match/match-many query
          (m :guard sandbox-map?) [nil (:query-permissions/sandboxed-table m)])))

(defn- sandbox-details
  "Audit-log entries for the current user's sandboxes of the Tables with `table-ids`."
  [table-ids]
  (let [pii?       (analytics.settings/analytics-pii-retention-enabled)
        sandboxes  (data-access.sandbox/current-user-sandboxes)]
    (vec
     (for [table-id (sort table-ids)
           :let     [{:keys [id group_id card_id attribute_remappings] :as sandbox}
                     (first (sort-by :id (filter #(= (:table_id %) table-id) sandboxes)))]
           :when    sandbox
           :let     [values (when pii? (try (data-access.sandbox/sandbox-attribute-values sandbox)
                                            (catch Throwable _ nil)))]]
       {:table_id   table-id
        :sandbox_id id
        :group_id   group_id
        :card_id    card_id
        :attributes (into {}
                          (map (fn [[attribute target]]
                                 (let [field-id (match/match-one target
                                                  [:field _ (id :guard pos-int?)] id
                                                  [:field (id :guard pos-int?) _] id)]
                                   [attribute (cond-> {:field_id field-id}
                                                pii? (assoc :value (get values attribute)))])))
                          attribute_remappings)}))))

(defn merge-sandboxing-metadata
  "Post-processing middleware. Marks the results of a sandboxed query with `:is_sandboxed` and records which sandboxes
  applied under `:sandbox_details`, for the query execution log."
  [query rff]
  (let [table-ids (sandboxed-table-ids (:stages query))]
    (if (empty? table-ids)
      rff
      (fn merge-sandboxing-metadata-rff* [metadata]
        (rff (assoc metadata
                    :is_sandboxed    true
                    :sandbox_details (sandbox-details table-ids)))))))

;;; ------------------------------------------- Blocked and native access --------------------------------------------

(defn- user-level-native?
  "Whether legacy `query` has a native query that wasn't put there by a sandbox."
  [query]
  (or (= :native (keyword (:type query)))
      (boolean
       (match/match-one (:query query)
         (_ :guard sandbox-map?) nil
         (_ :guard native-map?)  true))))

(defn- query-table-ids
  "IDs of the Tables legacy `query` reads, including through saved questions, but not inside sandboxes (only the
  sandboxed table itself)."
  [query]
  (into #{}
        (match/match-many (:query query)
          (m :guard sandbox-map?)      (:query-permissions/sandboxed-table m)
          (m :guard source-table-map?) (:source-table m))))

(defn- blocked-error
  "The usual 403 for a query the current user lacks data permissions for, naming the permission they lack."
  [required-perms]
  (query-perms/perms-exception (tru "You do not have permissions to run this query.") required-perms {:status-code 403}))

(defn check-block-permissions
  "Throws a 403 when the current user may not run the (already preprocessed, legacy) `query`, whatever their access to
  the saved questions it uses:

  * it reads a table they have `:blocked` view-data access to;
  * it has a native query (not one of a sandbox) and they are blocked from any table of the database, or a sandbox
    applies to them on the database: a native query could read the sandboxed table directly."
  [{database-id :database :as query}]
  (when (and api/*current-user-id* (not api/*is-superuser?*) (pos-int? database-id))
    (let [table-ids (query-table-ids query)]
      (when (seq table-ids)
        (perms/prime-table-perms-cache {:db-ids #{database-id} :table-ids table-ids})
        (doseq [table-id table-ids]
          (when (= :blocked (perms/table-permission-for-user api/*current-user-id* :perms/view-data database-id table-id))
            (throw (blocked-error {database-id {:perms/view-data {table-id :unrestricted}}}))))))
    (when (user-level-native? query)
      (when (= :blocked (perms/full-database-permission-for-user api/*current-user-id* :perms/view-data database-id))
        (throw (blocked-error {database-id {:perms/view-data :unrestricted}})))
      (when (data-access.sandbox/sandboxed-user-for-db? database-id)
        (throw (ex-info (tru "You can''t run native (SQL) queries on this database because row and column security applies to your data access.")
                        {:type               qp.error-type/missing-required-permissions
                         :status-code        403
                         :permissions-error? true}))))
    nil))
