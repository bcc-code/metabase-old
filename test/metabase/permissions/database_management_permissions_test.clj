(ns metabase.permissions.database-management-permissions-test
  "Tests for the manage database permission: managing some databases without being an admin."
  (:require
   [clojure.test :refer :all]
   [metabase.permissions.advanced-test-util :as advanced-test-util]
   [metabase.permissions.core :as perms]
   [metabase.test :as mt]
   [metabase.test.fixtures :as fixtures]
   [metabase.util :as u]
   [toucan2.core :as t2]))

(use-fixtures :once (fixtures/initialize :db :test-users))

(defn- do-with-database-manager!
  "Call `f` with a `:managed-db`, an `:other-db`, and a `:user` whose group may manage `:managed-db` only."
  [f]
  (mt/with-temp [:model/Database managed-db {:name "Aviary" :engine :h2 :details {:db "mem:aviary"}}
                 :model/Database other-db   {:name "Hatchery" :engine :h2 :details {:db "mem:hatchery"}}]
    (mt/with-user-in-groups [group {:name "Database managers"}
                             user  [group]]
      (perms/set-database-permission! group managed-db :perms/manage-database :yes)
      (f {:user user :managed-db managed-db :other-db other-db}))))

(deftest manage-database-test
  (advanced-test-util/with-advanced-permissions
    (do-with-database-manager!
     (fn [{:keys [user managed-db other-db]}]
       (testing "the user can edit the database they manage"
         (mt/user-http-request user :put 200 (str "database/" (u/the-id managed-db)) {:description "Birds"})
         (is (= "Birds" (t2/select-one-fn :description :model/Database :id (u/the-id managed-db))))
         (testing "and see its connection details"
           (is (contains? (mt/user-http-request user :get 200 (str "database/" (u/the-id managed-db))) :details)))
         (mt/user-http-request user :post 200 (format "database/%d/discard_values" (u/the-id managed-db))))
       (testing "but not other databases"
         (mt/user-http-request user :put 403 (str "database/" (u/the-id other-db)) {:description "Eggs"})
         (mt/user-http-request user :post 403 (format "database/%d/discard_values" (u/the-id other-db)))
         (is (nil? (t2/select-one-fn :description :model/Database :id (u/the-id other-db)))))
       (testing "deleting and adding databases stays admin-only"
         (mt/user-http-request user :delete 403 (str "database/" (u/the-id managed-db)))
         (is (t2/exists? :model/Database :id (u/the-id managed-db)))
         (mt/user-http-request user :post 403 "database" {:name    "Nest"
                                                          :engine  "h2"
                                                          :details {:db "mem:nest"}}))
       (testing "GET /api/database?exclude_uneditable_details=true lists the databases the user manages"
         (is (= [(u/the-id managed-db)]
                (map :id (:data (mt/user-http-request user :get 200 "database" :exclude_uneditable_details true))))))
       (testing "GET /api/user/current says the user can manage databases"
         (is (true? (get-in (mt/user-http-request user :get 200 "user/current")
                            [:permissions :can_access_db_details]))))
       (testing "people without the permission can't edit the database"
         (mt/user-http-request :rasta :put 403 (str "database/" (u/the-id managed-db)) {:description "Nests"}))
       (testing "while the feature is disabled only admins can manage databases"
         (advanced-test-util/without-advanced-permissions
           (mt/user-http-request user :put 403 (str "database/" (u/the-id managed-db)) {:description "Nests"})))))))
