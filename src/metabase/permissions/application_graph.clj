(ns metabase.permissions.application-graph
  "The application permissions graph: for each group, whether it may access the admin Settings (`:setting`), use the
  Monitoring tools (`:monitoring`), and create dashboard subscriptions and alerts (`:subscription`). This is the shape
  the permissions editor reads and writes; the grants themselves are rows in `permissions`."
  (:require
   [clojure.data :as data]
   [metabase.permissions.db :as permissions.db]
   [metabase.permissions.models.application-permissions-revision :as application-permissions-revision]
   [metabase.permissions.models.permissions :as perms]
   [metabase.permissions.models.permissions-group :as perms-group]
   [metabase.permissions.path :as permissions.path]
   [metabase.permissions.schema :as permissions.schema]
   [metabase.permissions.util :as perms.u]
   [metabase.util :as u]
   [metabase.util.i18n :refer [tru]]
   [metabase.util.malli :as mu]
   [toucan2.core :as t2]))

(set! *warn-on-reflection* true)

(def ^:private perm-types
  [:setting :monitoring :subscription])

(mu/defn graph :- ::permissions.schema/application-permissions-graph
  "The current application permissions graph. Administrators hold every application permission. Tenant groups are
  left out while the Tenants feature is disabled."
  []
  (let [admin-group-id (u/the-id (perms-group/admin))
        group-ids      (permissions.db/all-group-ids)
        hidden         (perms-group/hidden-tenant-group-ids group-ids)
        holders        (into {}
                             (map (fn [perm-type]
                                    [perm-type (permissions.db/group-ids-with-permission-objects
                                                [(permissions.path/application-perms-path perm-type)])]))
                             perm-types)]
    {:revision (application-permissions-revision/latest-id)
     :groups   (into {}
                     (comp (remove hidden)
                           (map (fn [group-id]
                                  [group-id (into {}
                                                  (map (fn [perm-type]
                                                         [perm-type (if (or (= group-id admin-group-id)
                                                                            (contains? (holders perm-type) group-id))
                                                                      :yes
                                                                      :no)]))
                                                  perm-types)])))
                     group-ids)}))

(defn- check-changes-allowed!
  "Throw unless every group in `changes` (group ID -> permission type -> level) exists, is visible, may hold the
  levels requested, and isn't the Administrators group."
  [changes current-group-ids]
  (let [group-ids (set (keys changes))]
    (when-let [unknown (seq (remove current-group-ids group-ids))]
      (throw (ex-info (tru "No permissions group with ID {0}." (first unknown))
                      {:status-code 404})))
    (when (contains? group-ids (u/the-id (perms-group/admin)))
      (throw (ex-info (tru "You cannot change the application permissions of the Administrators group.")
                      {:status-code 400})))
    (let [tenant-group? (permissions.db/group-tenant-flags group-ids)]
      (doseq [[group-id group-changes] changes
              [perm-type level]        group-changes
              :when (and (tenant-group? group-id)
                         (= level :yes)
                         (not= perm-type :subscription))]
        (throw (ex-info (tru "Tenant groups can only be granted the subscriptions and alerts application permission.")
                        {:status-code 400}))))))

(defn- apply-changes!
  [changes]
  (doseq [[group-id group-changes] changes
          [perm-type level]        group-changes]
    (case level
      :yes (perms/grant-application-permissions! group-id perm-type)
      :no  (perms/revoke-application-permissions! group-id perm-type))))

(mu/defn update-graph! :- ::permissions.schema/application-permissions-graph
  "Apply the changes in `new-graph` to the application permissions and record them as a revision. Throws a 409 when
  the graph changed since `new-graph`'s `:revision` (unless `:force` is set), a 404 for an unknown group and a 400 for
  a change to the Administrators group or a tenant group's settings or monitoring access. Returns the updated graph."
  [new-graph :- ::permissions.schema/application-permissions-graph.update]
  (t2/with-transaction [_conn]
    (let [old-graph (graph)
          ;; only the groups mentioned in `new-graph`, and their permission types it mentions, take part in the diff
          mentioned (into {}
                          (map (fn [[group-id group-changes]]
                                 [group-id (select-keys (get-in old-graph [:groups group-id]) (keys group-changes))]))
                          (:groups new-graph))
          [before changes] (data/diff mentioned (:groups new-graph))]
      (perms.u/log-permissions-changes before changes)
      (perms.u/check-revision-numbers old-graph new-graph)
      (perms-group/check-tenant-groups-visible! (keys (:groups new-graph)))
      (when (seq changes)
        (check-changes-allowed! changes (set (keys (:groups old-graph))))
        (apply-changes! changes)
        (perms.u/save-perms-revision! :model/ApplicationPermissionsRevision (:revision old-graph) before changes))))
  (graph))
