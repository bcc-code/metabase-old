(ns metabase.permissions.data-model-permissions-test
  "Tests for the manage table metadata permission: editing the data model of some tables without being an admin."
  (:require
   [clojure.test :refer :all]
   [metabase.permissions.advanced-test-util :as advanced-test-util]
   [metabase.permissions.core :as perms]
   [metabase.test :as mt]
   [metabase.test.fixtures :as fixtures]
   [metabase.util :as u]))

(use-fixtures :once (fixtures/initialize :db :test-users))

(defn- do-with-data-model-manager!
  "Call `f` with a database holding an `:editable-table` and an `:other-table` (each with a field), and a `:user`
  whose group may manage the metadata of `:editable-table` only."
  [f]
  (mt/with-temp [:model/Database db             {:name "Aviary"}
                 :model/Table    editable-table {:db_id (u/the-id db) :name "parrots" :schema "PUBLIC"}
                 :model/Table    other-table    {:db_id (u/the-id db) :name "owls" :schema "PUBLIC"}
                 :model/Field    editable-field {:table_id (u/the-id editable-table) :name "beak"}
                 :model/Field    other-field    {:table_id (u/the-id other-table) :name "talon"}]
    (mt/with-user-in-groups [group {:name "Data stewards"}
                             user  [group]]
      (perms/set-table-permission! group editable-table :perms/manage-table-metadata :yes)
      (f {:db             db
          :user           user
          :editable-table editable-table
          :other-table    other-table
          :editable-field editable-field
          :other-field    other-field}))))

(deftest edit-table-and-field-metadata-test
  (advanced-test-util/with-advanced-permissions
    (do-with-data-model-manager!
     (fn [{:keys [user editable-table other-table editable-field other-field]}]
       (testing "metadata of tables the user's groups may manage can be edited"
         (is (= "Talkative birds"
                (:description (mt/user-http-request user :put 200 (str "table/" (u/the-id editable-table))
                                                    {:description "Talkative birds"}))))
         (is (= "Curved"
                (:description (mt/user-http-request user :put 200 (str "field/" (u/the-id editable-field))
                                                    {:description "Curved"}))))
         (is (= "Talkative birds"
                (:description (mt/user-http-request user :get 200 (str "table/" (u/the-id editable-table))
                                                    :include_editable_data_model true)))))
       (testing "other tables can't be edited"
         (mt/user-http-request user :put 403 (str "table/" (u/the-id other-table)) {:description "Night birds"})
         (mt/user-http-request user :put 403 (str "field/" (u/the-id other-field)) {:description "Sharp"})
         (mt/user-http-request user :get 403 (str "table/" (u/the-id other-table))
                               :include_editable_data_model true)
         (is (nil? (:description (mt/user-http-request :crowberto :get 200 (str "table/" (u/the-id other-table))))))
         (is (nil? (:description (mt/user-http-request :crowberto :get 200 (str "field/" (u/the-id other-field)))))))
       (testing "people without the permission can't edit anything"
         (mt/user-http-request :rasta :put 403 (str "table/" (u/the-id editable-table)) {:description "Parrots"}))
       (testing "while the feature is disabled only admins can edit metadata"
         (advanced-test-util/without-advanced-permissions
           (mt/user-http-request user :put 403 (str "table/" (u/the-id editable-table)) {:description "Parrots"})))))))

(deftest editable-data-model-listing-test
  (advanced-test-util/with-advanced-permissions
    (do-with-data-model-manager!
     (fn [{:keys [db user editable-table]}]
       (testing "GET /api/database?include_editable_data_model=true lists the databases the user can edit"
         (let [db-ids (into #{} (map :id) (:data (mt/user-http-request user :get 200 "database"
                                                                       :include_editable_data_model true)))]
           (is (contains? db-ids (u/the-id db)))
           (is (not (contains? db-ids (mt/id))))))
       (testing "GET /api/database/:id/metadata?include_editable_data_model=true lists only the editable tables"
         (is (= [(u/the-id editable-table)]
                (map :id (:tables (mt/user-http-request user :get 200 (format "database/%d/metadata" (u/the-id db))
                                                        :include_editable_data_model true))))))
       (testing "GET /api/table?include-editable-data-model=true lists only the editable tables"
         (is (= [(u/the-id editable-table)]
                (map :id (mt/user-http-request user :get 200 "table" :include-editable-data-model true)))))
       (testing "GET /api/database/:id/schemas?include_editable_data_model=true lists the schemas with editable tables"
         (is (= ["PUBLIC"]
                (mt/user-http-request user :get 200 (format "database/%d/schemas" (u/the-id db))
                                      :include_editable_data_model true))))
       (testing "databases the user can't edit are refused"
         (mt/user-http-request user :get 403 (format "database/%d/metadata" (mt/id))
                               :include_editable_data_model true))
       (testing "GET /api/user/current says the user can access the data model"
         (is (true? (get-in (mt/user-http-request user :get 200 "user/current")
                            [:permissions :can_access_data_model])))
         (is (false? (get-in (mt/user-http-request :rasta :get 200 "user/current")
                             [:permissions :can_access_data_model]))))))))

(deftest data-model-graph-round-trip-test
  (testing "the data model permission round-trips through the data permissions graph"
    (advanced-test-util/with-advanced-permissions
      (mt/with-temp [:model/PermissionsGroup {group-id :id} {}]
        (mt/with-restored-data-perms!
          (let [{:keys [revision]} (mt/user-http-request :crowberto :get 200 (format "permissions/graph/group/%d" group-id))
                db-perms          (fn [] (get-in (mt/user-http-request :crowberto :get 200
                                                                       (format "permissions/graph/group/%d" group-id))
                                                 [:groups group-id (mt/id)]))]
            (mt/user-http-request :crowberto :put 200 "permissions/graph"
                                  {:revision revision
                                   :groups   {group-id {(mt/id) {:view-data      "unrestricted"
                                                                 :create-queries "query-builder"
                                                                 :download       {:schemas "limited"}
                                                                 :data-model     {:schemas {"PUBLIC" {(mt/id :venues) "all"}}}
                                                                 :details        "yes"}}}})
            (is (=? {:download   {:schemas "limited"}
                     :data-model {:schemas {:PUBLIC {(mt/id :venues) "all"}}}
                     :details    "yes"}
                    (db-perms)))
            (is (= :ten-thousand-rows (perms/table-permission-for-groups #{group-id} :perms/download-results
                                                                         (mt/id) (mt/id :users))))
            (is (= :yes (perms/table-permission-for-groups #{group-id} :perms/manage-table-metadata
                                                           (mt/id) (mt/id :venues))))
            (is (= :no (perms/table-permission-for-groups #{group-id} :perms/manage-table-metadata
                                                          (mt/id) (mt/id :users))))))))))
