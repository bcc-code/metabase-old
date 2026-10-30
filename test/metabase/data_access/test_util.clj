(ns metabase.data-access.test-util
  "Helpers for testing row and column security (sandboxes) and connection impersonation."
  (:require
   [metabase.permissions.models.data-permissions :as data-perms]
   [metabase.permissions.test-util :as perms.test-util]
   [metabase.query-processor :as qp]
   [metabase.test :as mt]
   [toucan2.core :as t2]))

(defn do-with-sandboxed-user!
  "Runs `(f {:user-id :group-id :sandbox-ids})` with a new user who is a member of a new group, besides All Users.
  All Users has no data access; the group has unrestricted view-data and query-builder access to the test database,
  and the `sandboxes` (maps of `:table_id`, `:card_id`, `:attribute_remappings`) for its tables. The user has the
  login `attributes`."
  [{:keys [attributes sandboxes]} f]
  (perms.test-util/with-no-data-perms-for-all-users!
    (mt/with-temp [:model/PermissionsGroup           {group-id :id} {}
                   :model/User                       {user-id :id}  {:login_attributes attributes}
                   :model/PermissionsGroupMembership _              {:group_id group-id, :user_id user-id}]
      (data-perms/set-database-permission! group-id (mt/id) :perms/view-data :unrestricted)
      (data-perms/set-database-permission! group-id (mt/id) :perms/create-queries :query-builder)
      (let [sandbox-ids (mapv (fn [sandbox]
                                (:id (t2/insert-returning-instance! :model/Sandbox (assoc sandbox :group_id group-id))))
                              sandboxes)]
        (try
          (f {:user-id user-id, :group-id group-id, :sandbox-ids sandbox-ids})
          (finally
            (t2/delete! :model/Sandbox :group_id group-id)))))))

(defmacro with-sandboxed-user!
  "Runs `body` with `binding` bound to `{:user-id :group-id :sandbox-ids}` of a user sandboxed per `opts`. See
  [[do-with-sandboxed-user!]]."
  [[binding opts] & body]
  `(do-with-sandboxed-user! ~opts (fn [~binding] ~@body)))

(defn category-remapping
  "Attribute remapping of `attribute` onto `VENUES.CATEGORY_ID`."
  [attribute]
  {attribute [:dimension [:field (mt/id :venues :category_id) nil]]})

(defn rows-as
  "The rows of `query` run as the User with `user-id`."
  [user-id query]
  (mt/with-current-user user-id
    (mt/rows (qp/process-query query))))

(defn native-card-result-metadata
  "Result metadata of the native `query`, run with `parameters`, as the API would save it on a Card."
  [query parameters]
  (-> (qp/process-query (assoc query :parameters parameters))
      :data :results_metadata :columns))
