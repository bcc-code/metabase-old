(ns metabase.data-access.permissions-graph
  "Sandboxes and connection impersonation policies in the data permissions graph of Admin > Permissions.

  In the graph, a sandboxed table has view-data `:sandboxed` and an impersonated database `:impersonated`. Both are
  stored as `:unrestricted` data permissions plus a row in `sandboxes` or `connection_impersonations`; the graph API
  adds the rows' values back in when reading, and creates, updates and deletes the rows when the graph is saved.

  Graph updates are diffs: they hold only the values that changed. A sandbox (or impersonation policy) is deleted when
  an update gives its table (or database) a view-data value other than `:sandboxed` (`:impersonated`), directly or
  through its schema or database."
  (:require
   [metabase.data-access.db :as data-access.db]
   [metabase.data-access.impersonation :as data-access.impersonation]
   [metabase.data-access.models.sandbox :as data-access.models.sandbox]
   [metabase.driver.sql :as driver.sql]
   [metabase.driver.util :as driver.u]
   [metabase.lib-be.core :as lib-be]
   [metabase.lib.core :as lib]
   [metabase.lib.metadata :as lib.metadata]
   [metabase.permissions.core :as perms]
   [metabase.premium-features.core :as premium-features]
   [metabase.util.i18n :refer [tru]]))

(set! *warn-on-reflection* true)

;;; ------------------------------------------------ Reading the graph -----------------------------------------------

(defn- schema-key [schema]
  (or schema ""))

(defn- table-value
  "The view-data value of `table` in the API graph's view-data value `v` for its database. Missing entries are elided
  `:blocked` values."
  [v {:keys [id schema]}]
  (cond
    (keyword? v) v
    (map? v)     (let [schema-v (get v (schema-key schema))]
                   (cond
                     (keyword? schema-v) schema-v
                     (map? schema-v)     (get schema-v id :blocked)
                     :else               :blocked))
    :else        :blocked))

(defn- view-data-with-sandboxes
  "API graph view-data value `v` of a group on a database whose `tables` include the `sandboxed` table IDs: those are
  `:sandboxed`, their schemas are listed table by table, and other schemas keep a single value when they can."
  [v tables sandboxed]
  (into {}
        (keep (fn [[schema schema-tables]]
                (let [values (into {}
                                   (map (fn [table]
                                          [(:id table) (if (contains? sandboxed (:id table))
                                                         :sandboxed
                                                         (table-value v table))]))
                                   schema-tables)
                      distinct-values (set (vals values))]
                  (cond
                    (and (= 1 (count distinct-values))
                         (not (contains? distinct-values :sandboxed)))
                    (when-not (= #{:blocked} distinct-values)
                      [schema (first distinct-values)])

                    :else
                    [schema (into {} (remove (comp #{:blocked} val)) values)]))))
        (group-by (comp schema-key :schema) tables)))

(defn- graph-group-ids [{:keys [group-id group-ids]}]
  (cond
    group-id        #{group-id}
    (seq group-ids) (set group-ids)
    :else           nil))

(defn- view-data-wanted? [{:keys [perm-type]}]
  (or (nil? perm-type) (= perm-type :perms/view-data)))

(defn add-sandboxes-to-permissions-graph
  "Mark the sandboxed tables of API-style permissions `graph` (`{group-id {db-id perms}}`) as `:sandboxed`, for the
  groups and database the graph was built for (`opts`)."
  [graph & [opts]]
  (if-not (view-data-wanted? opts)
    graph
    (let [admin-id  (:id (perms/admin-group))
          sandboxes (remove #(= (:group_id %) admin-id)
                            (data-access.db/sandboxes-with-database (graph-group-ids opts) (:db-id opts)))]
      (if (empty? sandboxes)
        graph
        (let [tables-by-db (group-by :db_id (data-access.db/database-tables (into #{} (map :db_id) sandboxes)))]
          (reduce (fn [graph [[group-id db-id] group-sandboxes]]
                    (update-in graph [group-id db-id :view-data]
                               view-data-with-sandboxes
                               (get tables-by-db db-id)
                               (into #{} (map :table_id) group-sandboxes)))
                  graph
                  (group-by (juxt :group_id :db_id) sandboxes)))))))

(defn add-impersonations-to-permissions-graph
  "Mark the databases of API-style permissions `graph` that groups have connection impersonation policies on as
  `:impersonated`, for the groups and database the graph was built for (`opts`)."
  [graph & [opts]]
  (if-not (view-data-wanted? opts)
    graph
    (reduce (fn [graph {:keys [group_id db_id]}]
              (assoc-in graph [group_id db_id :view-data] :impersonated))
            graph
            (data-access.db/impersonations (graph-group-ids opts) (:db-id opts)))))

;;; ------------------------------------------- Saving the graph: cleanup --------------------------------------------

(defn- sandbox-replaced?
  "Whether the view-data update `v` (a graph diff value for a group on a database) gives `sandbox`'s table another
  value than `:sandboxed`."
  [v {:keys [table_id schema]}]
  (cond
    (keyword? v) (not= v :sandboxed)
    (map? v)     (let [schema-v (get v (schema-key schema))]
                   (cond
                     (keyword? schema-v) (not= schema-v :sandboxed)
                     (map? schema-v)     (let [table-v (get schema-v table_id)]
                                           (and (some? table-v) (not= table-v :sandboxed)))
                     :else               false))
    :else        false))

(defn- sandboxes-by-group-and-db
  "The sandboxes of the groups `group-ids`, indexed by `[group-id db-id]`, fetched with a single query so that saving
  the permissions graph costs the same number of queries however many groups and databases it changes."
  [group-ids]
  (group-by (juxt :group_id :db_id)
            (data-access.db/sandboxes-with-database (set group-ids) nil)))

(defn- replaced-sandboxes
  "The sandboxes graph update `graph` (`{group-id {db-id perms}}`) replaces. `by-group-and-db` is
  [[sandboxes-by-group-and-db]] of (at least) the groups of `graph`."
  ([graph]
   (replaced-sandboxes graph (sandboxes-by-group-and-db (keys graph))))
  ([graph by-group-and-db]
   (for [[group-id db-updates] graph
         [db-id db-changes]    db-updates
         :when                 (contains? db-changes :view-data)
         sandbox               (get by-group-and-db [group-id db-id])
         :when                 (sandbox-replaced? (:view-data db-changes) sandbox)]
     sandbox)))

(defn delete-sandboxes-if-needed-after-permissions-change!
  "Delete the sandboxes whose tables graph update `graph` gives another view-data value than `:sandboxed`."
  [graph]
  (data-access.db/delete-sandboxes-by-ids! (map :id (replaced-sandboxes graph)))
  nil)

(defn delete-impersonations-if-needed-after-permissions-change!
  "Delete the connection impersonation policies of databases graph update `graph` gives another view-data value than
  `:impersonated`."
  [graph]
  (let [deleted (for [[group-id db-updates] graph
                      [db-id db-changes]    db-updates
                      :when                 (and (contains? db-changes :view-data)
                                                 (not= :impersonated (:view-data db-changes)))]
                  (data-access.db/delete-impersonations! group-id db-id))]
    (when (pos? (reduce + 0 deleted))
      (data-access.impersonation/forget-database-policies!))
    nil))

(defn check-native-access-without-sandboxes!
  "Throws a 400 when a group of `native-group-db-ids` (`[group-id db-id]` pairs being granted native query access) still
  has a sandbox on that database once graph update `graph` is applied."
  [graph native-group-db-ids]
  (let [by-group-and-db (sandboxes-by-group-and-db (into (set (keys graph)) (map first) native-group-db-ids))
        replaced        (into #{} (map :id) (replaced-sandboxes graph by-group-and-db))]
    (doseq [[group-id db-id] native-group-db-ids
            :when (some #(not (contains? replaced (:id %)))
                        (get by-group-and-db [group-id db-id]))]
      (throw (ex-info (tru "A group with row and column security on a table of this database can''t also write native queries on it, since native queries aren''t restricted by row and column security.")
                      {:status-code 400, :group-id group-id, :database-id db-id})))))

;;; ------------------------------------------- Saving the graph: upserts --------------------------------------------

(defn- field-id-by-name [mp table-id field-name]
  (some #(when (= (:name %) field-name) (:id %)) (lib.metadata/fields mp table-id)))

(defn- normalize-remapping-target
  "Normalize one attribute remapping target as the API accepts it: a Field ID, a Field name (of the table, or a
  variable of a native sandbox question), or a parameter target."
  [mp table-id card-query attribute target]
  (cond
    (integer? target)
    [:dimension [:field target nil]]

    (string? target)
    (if-let [field-id (field-id-by-name mp table-id target)]
      [:dimension [:field field-id nil]]
      (if (and card-query (contains? (set (keys (lib/template-tags card-query))) target))
        [:variable [:template-tag target]]
        (throw (ex-info (tru "User attribute \"{0}\" is remapped onto \"{1}\", which is neither a column of the table nor a variable of the question."
                             attribute target)
                        {:status-code 400}))))

    :else
    target))

(defn normalize-attribute-remappings
  "`remappings` of a sandbox on the Table with `table-id` (and the question with `card-id`, if any) with every target
  normalized to a parameter target."
  [table-id card-id remappings]
  (when (some? remappings)
    (let [{db-id :db_id} (or (data-access.db/table table-id)
                             (throw (ex-info (tru "Table {0} does not exist." table-id) {:status-code 400})))
          mp             (lib-be/application-database-metadata-provider db-id)
          card-query     (when-let [card (when card-id (lib.metadata/card mp card-id))]
                           (lib/card->underlying-query mp card))]
      (data-access.models.sandbox/normalize-attribute-remappings
       (into {}
             (map (fn [[attribute target]]
                    [attribute (normalize-remapping-target mp table-id card-query attribute target)]))
             remappings)))))

(defn- revoke-native-access!
  "Native queries aren't restricted by sandboxes, so a group with a sandbox on a database can't write them there."
  [group-id db-id]
  (let [rows (get (perms/index-database-permissions [group-id] [db-id]) [group-id db-id :perms/create-queries])]
    (when (some #(and (nil? (:table_id %)) (= :query-builder-and-native (:perm_value %))) rows)
      (perms/set-database-permission! group-id db-id :perms/create-queries :query-builder))))

(defn upsert-sandbox!
  "Create or update one sandbox: the one with `:id`, else the one of `:group_id` on `:table_id`. Returns it."
  [{:keys [id group_id table_id card_id attribute_remappings] :as sandbox}]
  (let [existing (if id
                   (or (data-access.db/sandbox id)
                       (throw (ex-info (tru "Row and column security policy {0} does not exist." id) {:status-code 404})))
                   (data-access.db/sandbox-for-group-and-table group_id table_id))
        table-id (or table_id (:table_id existing))
        card-id  (if (contains? sandbox :card_id) card_id (:card_id existing))
        changes  (cond-> {}
                   (contains? sandbox :card_id)              (assoc :card_id card_id)
                   (contains? sandbox :attribute_remappings) (assoc :attribute_remappings
                                                                    (normalize-attribute-remappings
                                                                     table-id card-id attribute_remappings)))
        saved-id (if existing
                   (do
                     (when (seq changes)
                       (data-access.db/update-sandbox! (:id existing) changes))
                     (:id existing))
                   (:id (data-access.db/insert-sandbox! (merge {:group_id group_id, :table_id table_id} changes))))
        saved    (data-access.db/sandbox saved-id)]
    (revoke-native-access! (:group_id saved) (:db_id (data-access.db/table (:table_id saved))))
    saved))

(defn upsert-sandboxes!
  "Create or update `sandboxes`, sent along with a permissions graph update. Returns them as saved."
  [sandboxes]
  (premium-features/assert-has-feature :sandboxes (tru "Row and column security"))
  (mapv upsert-sandbox! sandboxes))

(defn check-database-supports-impersonation!
  "Throws a 400 unless the Database with `db-id` can use connection impersonation."
  [db-id]
  (let [mp       (lib-be/application-database-metadata-provider db-id)
        database (lib.metadata/database mp)
        engine   (:engine database)]
    (when-not (and engine (driver.u/supports? engine :connection-impersonation database))
      (throw (ex-info (tru "This database doesn''t support connection impersonation.")
                      {:status-code 400, :database-id db-id})))
    (when (and (driver.u/supports? engine :connection-impersonation-requires-role database)
               (nil? (driver.sql/default-database-role engine database)))
      (throw (ex-info (tru "Connection impersonation on this database needs a default role. Set the role in the database connection settings first.")
                      {:status-code 400, :database-id db-id})))))

(defn insert-impersonations!
  "Save connection impersonation `impersonations` (`{:group_id :db_id :attribute}`), sent along with a permissions
  graph update, replacing the policy each group had on that database. Returns them as saved."
  [impersonations]
  (premium-features/assert-has-feature :advanced-permissions (tru "Connection impersonation"))
  (let [saved (mapv (fn [{:keys [group_id db_id attribute]}]
                      (check-database-supports-impersonation! db_id)
                      (data-access.db/delete-impersonations! group_id db_id)
                      (data-access.db/insert-impersonation! {:group_id group_id, :db_id db_id, :attribute attribute}))
                    impersonations)]
    (data-access.impersonation/forget-database-policies!)
    saved))
