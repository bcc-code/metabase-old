(ns metabase.data-access.sandbox
  "Which sandboxes (row and column security policies) apply to a user, and what they let the user see.

  ### Which sandboxes are enforced

  A sandbox belongs to a group and a table. A user gets the sandboxes of every group they belong to, except:

  * admins are never sandboxed;
  * a sandbox on table T is not enforced when the user is also in a group *without* a sandbox on T that has
    unrestricted view-data access to T. Data access is additive, and that group grants unrestricted access.

  When more than one enforced sandbox applies to the same table (the user is in several sandboxed groups), the table
  can only be queried if they are all the same policy (same question and attribute remappings); otherwise queries on it
  fail. Merging different policies could widen access in ways nobody configured, so we refuse rather than guess.

  Enforcement does not depend on any feature flag: a configured sandbox is enforced as long as it exists."
  (:require
   [clojure.core.memoize :as memoize]
   [metabase.api.common :as api]
   [metabase.data-access.attributes :as data-access.attributes]
   [metabase.data-access.db :as data-access.db]
   [metabase.data-access.validation :as data-access.validation]
   [metabase.lib-be.core :as lib-be]
   [metabase.lib.metadata :as lib.metadata]
   [metabase.permissions.core :as perms]
   [metabase.util :as u]
   [metabase.util.i18n :refer [tru]]
   [metabase.util.log :as log]))

(set! *warn-on-reflection* true)

;;; ----------------------------------------------- Enforced sandboxes -----------------------------------------------

(defn enforced-sandboxes-for-user
  "The set of sandboxes enforced for the User with `user-id`. Each is a sandbox row with its table's `:db_id` and its
  question's `:card_updated_at`. Empty for admins and for users without sandboxes."
  [user-id]
  (if (or (nil? user-id) (perms/is-superuser? user-id))
    #{}
    (let [sandboxes (data-access.db/user-sandboxes user-id)]
      (if (empty? sandboxes)
        #{}
        (let [group-ids        (data-access.db/user-group-ids user-id)
              sandboxes        (map #(into {} %) sandboxes)
              by-table         (group-by :table_id sandboxes)
              overridden?      (fn [[table-id table-sandboxes]]
                                 (let [sandboxed-groups (into #{} (map :group_id) table-sandboxes)
                                       other-groups     (into #{} (remove sandboxed-groups) group-ids)]
                                   (and (seq other-groups)
                                        (perms/groups-have-permission-for-table?
                                         other-groups :perms/view-data :unrestricted
                                         (:db_id (first table-sandboxes)) table-id))))]
          (into #{}
                (comp (remove overridden?)
                      (mapcat val))
                by-table))))))

(defn current-user-sandboxes
  "The sandboxes enforced for the current user: none for admins (including code running `as-admin`, such as public
  links and static embeds, which are authorized by their signed token instead). Read from the request-scoped cache when
  it's there."
  []
  (cond
    (nil? api/*current-user-id*) #{}
    api/*is-superuser?*          #{}
    :else                        (or (perms/sandboxes-for-user)
                                     ;; not inside `with-relevant-permissions-for-user`, which caches it
                                     (enforced-sandboxes-for-user api/*current-user-id*))))

(defn sandboxed-user?
  "Whether any sandbox is enforced for the current user."
  []
  (boolean (seq (current-user-sandboxes))))

(defn sandboxed-user-for-db?
  "Whether any sandbox is enforced for the current user on a table of the Database `db-or-id`."
  [db-or-id]
  (let [db-id (u/the-id db-or-id)]
    (boolean (some #(= (:db_id %) db-id) (current-user-sandboxes)))))

(defn- same-policy? [sandboxes]
  (= 1 (count (into #{} (map (juxt :card_id :attribute_remappings)) sandboxes))))

(defn sandbox-for-table
  "The sandbox enforced for the current user on the Table with `table-id`, or nil when it isn't sandboxed for them.
  Throws a 403 when several different sandboxes apply to it."
  [table-id]
  (let [sandboxes (sort-by :id (filter #(= (:table_id %) table-id) (current-user-sandboxes)))]
    (cond
      (empty? sandboxes)        nil
      (same-policy? sandboxes)  (first sandboxes)
      :else
      (throw (ex-info (tru "Your groups have different row and column security policies for the same table, so it can''t be queried. Ask an administrator to keep only one of them.")
                      {:status-code 403
                       :type        :missing-required-permissions
                       :table-id    table-id
                       :sandbox-ids (mapv :id sandboxes)})))))

(defn sandbox-attribute-values
  "Attribute name -> the current user's value, for each attribute `sandbox` remaps. Throws a 403 when the user lacks
  one of them."
  [{:keys [attribute_remappings]}]
  (let [attributes (data-access.attributes/user-attributes api/*current-user-id*)]
    (into (sorted-map)
          (map (fn [[attribute _target]]
                 [attribute (data-access.attributes/required-attribute-value attributes attribute :sandbox)]))
          attribute_remappings)))

(defn sandboxed-group-ids-in-database
  "Those of `group-ids` that have a sandbox on a table of the Database with `db-id`."
  [db-id group-ids]
  (data-access.db/sandboxed-group-ids-in-database db-id (set group-ids)))

(defn sandboxes-in-database?
  "Whether any group has a sandbox on a table of the Database with `db-id`."
  [db-id]
  (data-access.db/database-has-sandboxes? db-id))

;;; ------------------------------------------------- Cache tokens ---------------------------------------------------

(defn sandbox-token-for-table
  "What decides the rows the current user sees of the Table with `table-id` under their sandbox, or nil when it isn't
  sandboxed for them: the sandbox, its question and the question's version, and the user's attribute values (nil for a
  missing one, which makes queries fail anyway)."
  [table-id]
  (let [sandboxes (sort-by :id (filter #(= (:table_id %) table-id) (current-user-sandboxes)))]
    (when (seq sandboxes)
      (let [attributes (data-access.attributes/user-attributes api/*current-user-id*)]
        (vec (for [{:keys [id card_id card_updated_at attribute_remappings]} sandboxes]
               {:sandbox-id      id
                :card-id         card_id
                :card-updated-at (some-> card_updated_at str)
                :attributes      (into (sorted-map)
                                       (map (fn [[attribute _]] [attribute (get attributes attribute)]))
                                       attribute_remappings)}))))))

(defn hash-input-for-sandbox
  "The part of the FieldValues cache key that depends on the current user's sandbox on `field`'s table: nil when the
  table isn't sandboxed for them, `{:sandbox nil}` (no cached values may be used) when the sandbox can't be resolved."
  [field]
  (when-let [table-id ((some-fn :table_id :table-id) field)]
    (try
      (when-let [token (sandbox-token-for-table table-id)]
        {:sandbox token})
      (catch Throwable e
        (log/warnf e "Could not resolve the sandbox of table %s for FieldValues" table-id)
        {:sandbox nil}))))

;;; ---------------------------------------------- Column restrictions -----------------------------------------------

(def ^:private card-column-cache
  ;; keyed by question and its last update, so editing the question invalidates the entry
  (memoize/lru (fn [db-id card-id _card-updated-at]
                 (let [mp (lib-be/application-database-metadata-provider db-id)]
                   (mapv #(select-keys % [:id :name :base-type :effective-type])
                         (data-access.validation/card-columns mp card-id))))
               :lru/threshold 500))

(defn sandbox-columns
  "The `[column field]` pairs of the columns the question of `sandbox` returns and the Fields of the sandboxed table
  they stand for, or nil when the sandbox has no question (it returns every column)."
  [{:keys [db_id table_id card_id card_updated_at]}]
  (when card_id
    (let [mp     (lib-be/application-database-metadata-provider db_id)
          table  (lib.metadata/table mp table_id)
          fields (lib.metadata/fields mp table_id)]
      (data-access.validation/column-field-mapping (:name table) fields
                                                   (card-column-cache db_id card_id (some-> card_updated_at str))))))

(defn allowed-field-ids
  "The IDs of the Fields of the sandboxed table that `sandbox` lets its users see, or nil when it doesn't restrict
  columns. When the question's columns can't be determined, no Field is allowed."
  [sandbox]
  (when (:card_id sandbox)
    (try
      (into #{} (map (comp :id second)) (sandbox-columns sandbox))
      (catch Throwable e
        (log/warnf e "Could not determine the columns of sandbox %s; hiding every column" (:id sandbox))
        #{}))))

(defn sandbox-restricted-fields
  "For those of `table-ids` whose columns the current user's sandboxes restrict, `{table-id #{allowed-field-id}}`.
  nil when no sandbox applies to the current user. A table sandboxed by conflicting policies allows no Field."
  [table-ids]
  (let [sandboxes (current-user-sandboxes)]
    (when (seq sandboxes)
      (let [table-ids (set table-ids)]
        (not-empty
         (into {}
               (keep (fn [[table-id table-sandboxes]]
                       (when (contains? table-ids table-id)
                         (cond
                           (not (same-policy? table-sandboxes))
                           [table-id #{}]

                           (:card_id (first table-sandboxes))
                           [table-id (allowed-field-ids (first table-sandboxes))]))))
               (group-by :table_id sandboxes)))))))

(defn filter-sandboxed-fields
  "`fields` of the Table with `table-id`, without the ones the current user's sandbox on it hides."
  [table-id fields]
  (if-let [allowed (get (sandbox-restricted-fields [table-id]) table-id)]
    (filterv #(contains? allowed (:id %)) fields)
    fields))

(defn batch-filter-sandboxed-fields
  "`fields-by-table` (`{table-id fields}`) without the Fields the current user's sandboxes hide."
  [fields-by-table]
  (let [restricted (sandbox-restricted-fields (keys fields-by-table))]
    (if (empty? restricted)
      fields-by-table
      (into {}
            (map (fn [[table-id fields]]
                   [table-id (if-let [allowed (get restricted table-id)]
                               (filterv #(contains? allowed (:id %)) fields)
                               fields)]))
            fields-by-table))))
