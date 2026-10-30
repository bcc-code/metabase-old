(ns metabase.data-access.permissions-graph-test
  "Sandboxes and connection impersonation policies in the data permissions graph API."
  (:require
   [clojure.test :refer :all]
   [metabase.data-access.test-util :as data-access.tu]
   [metabase.permissions-rest.data-permissions.graph :as data-perms.graph]
   [metabase.permissions.models.data-permissions :as data-perms]
   [metabase.permissions.test-util :as perms.test-util]
   [metabase.test :as mt]
   [toucan2.core :as t2]))

(set! *warn-on-reflection* true)

(defn- group-view-data [group-id db-id]
  (get-in (data-perms.graph/api-graph {:group-id group-id}) [:groups group-id db-id :view-data]))

(deftest graph-shows-sandboxed-tables-test
  (testing "GET /api/permissions/graph shows a sandboxed table as :sandboxed, its schema table by table"
    (data-access.tu/with-sandboxed-user! [{:keys [group-id]} {:attributes {"cat" "50"}
                                                              :sandboxes  [{:table_id             (mt/id :venues)
                                                                            :attribute_remappings (data-access.tu/category-remapping "cat")}]}]
      (let [view-data (group-view-data group-id (mt/id))]
        (is (= :sandboxed (get-in view-data ["PUBLIC" (mt/id :venues)])))
        (is (= :unrestricted (get-in view-data ["PUBLIC" (mt/id :checkins)]))))
      (testing "through the API, too"
        (is (= "sandboxed"
               (get-in (mt/user-http-request :crowberto :get 200 (format "permissions/graph/group/%d" group-id))
                       [:groups group-id (mt/id) :view-data :PUBLIC (mt/id :venues)])))))))

(deftest save-graph-with-sandboxes-test
  (testing "PUT /api/permissions/graph saves the sandboxes sent with the graph"
    (mt/with-premium-features #{:sandboxes}
      (perms.test-util/with-no-data-perms-for-all-users!
        (mt/with-temp [:model/PermissionsGroup {group-id :id} {}]
          (data-perms/set-database-permission! group-id (mt/id) :perms/create-queries :query-builder-and-native)
          (let [graph    (data-perms.graph/api-graph {:group-id group-id})
                graph    (assoc-in graph [:groups group-id (mt/id) :view-data] {"PUBLIC" {(mt/id :venues) :sandboxed}})
                graph    (assoc-in graph [:groups group-id (mt/id) :create-queries] :query-builder)
                response (mt/user-http-request :crowberto :put 200 "permissions/graph"
                                               (assoc graph :sandboxes [{:group_id             group-id
                                                                         :table_id             (mt/id :venues)
                                                                         :attribute_remappings {"cat" (mt/id :venues :category_id)}}]))]
            (is (=? [{:group_id             group-id
                      :table_id             (mt/id :venues)
                      :attribute_remappings {:cat ["dimension" ["field" (mt/id :venues :category_id) nil]]}}]
                    (:sandboxes response)))
            (is (= :sandboxed (get-in (group-view-data group-id (mt/id)) ["PUBLIC" (mt/id :venues)])))
            (testing "giving the table another view-data value deletes the sandbox"
              (mt/user-http-request :crowberto :put 200 "permissions/graph"
                                    (assoc-in (data-perms.graph/api-graph {:group-id group-id})
                                              [:groups group-id (mt/id) :view-data] :unrestricted))
              (is (not (t2/exists? :model/Sandbox :group_id group-id))))))))))

(deftest sandbox-revokes-native-access-test
  (testing "saving a sandbox revokes the group's native query access to the database"
    (mt/with-premium-features #{:sandboxes}
      (perms.test-util/with-no-data-perms-for-all-users!
        (mt/with-temp [:model/PermissionsGroup {group-id :id} {}]
          (data-perms/set-database-permission! group-id (mt/id) :perms/view-data :unrestricted)
          (data-perms/set-database-permission! group-id (mt/id) :perms/create-queries :query-builder-and-native)
          (mt/user-http-request :crowberto :put 200 "permissions/graph"
                                (assoc (data-perms.graph/api-graph {:group-id group-id})
                                       :sandboxes [{:group_id             group-id
                                                    :table_id             (mt/id :venues)
                                                    :attribute_remappings {"cat" (mt/id :venues :category_id)}}]))
          (is (= :query-builder (data-perms/table-permission-for-groups #{group-id} :perms/create-queries (mt/id) (mt/id :venues))))
          (testing "and native access can't be granted back while the sandbox exists"
            (is (re-find #"native queries"
                         (mt/user-http-request :crowberto :put 400 "permissions/graph"
                                               (assoc-in (data-perms.graph/api-graph {:group-id group-id})
                                                         [:groups group-id (mt/id) :create-queries]
                                                         :query-builder-and-native))))))))))

(deftest graph-impersonations-test
  (testing "connection impersonation policies round-trip through the graph"
    (mt/with-premium-features #{:advanced-permissions}
      (mt/with-temp [:model/Database         {db-id :id}    {:engine :postgres}
                     :model/PermissionsGroup {group-id :id} {}]
        (let [response (mt/user-http-request :crowberto :put 200 "permissions/graph"
                                             (-> (data-perms.graph/api-graph {:group-id group-id})
                                                 (assoc-in [:groups group-id db-id :view-data] :impersonated)
                                                 (assoc :impersonations [{:group_id group-id, :db_id db-id, :attribute "db_role"}])))]
          (is (=? [{:group_id group-id, :db_id db-id, :attribute "db_role"}] (:impersonations response)))
          (is (= :impersonated (group-view-data group-id db-id)))
          (is (= :unrestricted (t2/select-one-fn :perm_value :model/DataPermissions
                                                 :group_id group-id :db_id db-id :perm_type :perms/view-data :table_id nil)))
          (testing "giving the database another view-data value deletes the policy"
            (mt/user-http-request :crowberto :put 200 "permissions/graph"
                                  (assoc-in (data-perms.graph/api-graph {:group-id group-id})
                                            [:groups group-id db-id :view-data] :unrestricted))
            (is (not (t2/exists? :model/ConnectionImpersonation :group_id group-id)))))))))

(deftest impersonation-requires-supported-database-test
  (testing "a database whose driver doesn't support connection impersonation can't get a policy"
    (mt/with-premium-features #{:advanced-permissions}
      (mt/with-temp [:model/PermissionsGroup {group-id :id} {}]
        (is (re-find #"doesn't support connection impersonation"
                     (str (mt/user-http-request :crowberto :put 400 "permissions/graph"
                                                (assoc (data-perms.graph/api-graph {:group-id group-id})
                                                       :impersonations [{:group_id group-id, :db_id (mt/id), :attribute "x"}])))))))))
