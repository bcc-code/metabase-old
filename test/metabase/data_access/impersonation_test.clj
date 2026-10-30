(ns metabase.data-access.impersonation-test
  "Connection impersonation: which role applies to whom, and how it reaches pooled connections."
  (:require
   [clojure.test :refer :all]
   [metabase.data-access.impersonation :as data-access.impersonation]
   [metabase.driver :as driver]
   [metabase.lib-be.core :as lib-be]
   [metabase.lib.metadata :as lib.metadata]
   [metabase.permissions.core :as perms]
   [metabase.permissions.models.data-permissions :as data-perms]
   [metabase.permissions.test-util :as perms.test-util]
   [metabase.test :as mt])
  (:import
   (java.sql Connection)))

(set! *warn-on-reflection* true)

(defn- do-with-impersonated-user!
  "Runs `(f {:user-id :group-id :db-id})` with a user in a group with an impersonation policy on a (fake) Postgres
  database, taking the role from attribute `\"db_role\"`, which the user has the value `role` for."
  [role f]
  (perms.test-util/with-no-data-perms-for-all-users!
    (mt/with-temp [:model/Database                   {db-id :id}    {:engine :postgres}
                   :model/PermissionsGroup           {group-id :id} {}
                   :model/User                       {user-id :id}  {:login_attributes (if role {"db_role" role} {})}
                   :model/PermissionsGroupMembership _              {:group_id group-id, :user_id user-id}
                   :model/ConnectionImpersonation    _              {:group_id group-id, :db_id db-id, :attribute "db_role"}]
      ;; the database was created after All Users lost its access, so it got the default (unrestricted) access
      (data-perms/set-database-permission! (perms/all-users-group) db-id :perms/view-data :blocked)
      (data-perms/set-database-permission! group-id db-id :perms/view-data :unrestricted)
      (data-access.impersonation/forget-database-policies!)
      (f {:user-id user-id, :group-id group-id, :db-id db-id}))))

(deftest impersonation-role-test
  (do-with-impersonated-user!
   "analyst"
   (fn [{:keys [user-id group-id db-id]}]
     (testing "a user in a group with an impersonation policy uses their attribute as the role"
       (mt/with-current-user user-id
         (is (= {:role "analyst"} (data-access.impersonation/impersonation-for-db db-id)))
         (is (perms/impersonated-user?))
         (is (perms/impersonation-enforced-for-db? db-id))
         (is (not (perms/impersonation-enforced-for-db? (mt/id))))
         (is (= {:database db-id, :impersonation/role "analyst"}
                (data-access.impersonation/apply-impersonation {:database db-id})))))
     (testing "admins are never impersonated"
       (mt/with-test-user :crowberto
         (is (nil? (data-access.impersonation/impersonation-for-db db-id)))))
     (testing "different roles from two groups are an error"
       (mt/with-temp [:model/PermissionsGroup           {other-group :id} {}
                      :model/PermissionsGroupMembership _                 {:group_id other-group, :user_id user-id}
                      :model/ConnectionImpersonation    _                 {:group_id other-group, :db_id db-id, :attribute "other"}]
         (mt/with-temp-vals-in-db :model/User user-id {:login_attributes {"db_role" "analyst", "other" "admin_role"}}
           (mt/with-current-user user-id
             (is (thrown-with-msg? clojure.lang.ExceptionInfo #"different database roles"
                                   (data-access.impersonation/impersonation-for-db db-id)))
             (is (perms/impersonation-enforced-for-db? db-id)
                 "enforced even though it can't be resolved, so queries don't run unimpersonated")))))
     (testing "another group with unrestricted access to the whole database lifts impersonation"
       (mt/with-temp [:model/PermissionsGroup           {other-group :id} {}
                      :model/PermissionsGroupMembership _                 {:group_id other-group, :user_id user-id}]
         (data-perms/set-database-permission! other-group db-id :perms/view-data :unrestricted)
         (mt/with-current-user user-id
           (is (nil? (data-access.impersonation/impersonation-for-db db-id))))))
     (testing "a sandbox on the same database conflicts with impersonation"
       (mt/with-temp [:model/Table   {table-id :id} {:db_id db-id, :schema "public", :name "t"}
                      :model/Sandbox _              {:group_id group-id, :table_id table-id}]
         (mt/with-current-user user-id
           (is (thrown-with-msg? clojure.lang.ExceptionInfo #"Conflicting"
                                 (data-access.impersonation/impersonation-for-db db-id)))))))))

(deftest missing-role-attribute-test
  (testing "a user without the policy's attribute can't run queries on the database"
    (do-with-impersonated-user!
     nil
     (fn [{:keys [user-id db-id]}]
       (mt/with-current-user user-id
         (is (thrown-with-msg? clojure.lang.ExceptionInfo #"requires the user attribute \"db_role\""
                               (data-access.impersonation/impersonation-for-db db-id))))))))

(defn- fake-connection ^Connection []
  (reify Connection))

(deftest set-role-on-checkout-test
  (testing "the bound role is set on checked-out connections, and reset on the next checkout without it"
    (do-with-impersonated-user!
     "analyst"
     (fn [{:keys [db-id]}]
       (let [roles-set (atom [])
             conn      (fake-connection)
             database  (lib.metadata/database (lib-be/application-database-metadata-provider db-id))]
         (with-redefs [driver/set-role! (fn [_driver _conn role] (swap! roles-set conj role))]
           (testing "while a query runs under a role"
             (binding [data-access.impersonation/*impersonation* {:db-id db-id, :role "analyst"}]
               (data-access.impersonation/set-role-if-supported! :postgres conn database)
               (is (data-access.impersonation/currently-impersonated?))))
           (testing "a later checkout without a role puts back the default role"
             (data-access.impersonation/set-role-if-supported! :postgres conn database))
           (testing "the role bound for another database is not used"
             (binding [data-access.impersonation/*impersonation* {:db-id (mt/id), :role "analyst"}]
               (data-access.impersonation/set-role-if-supported! :postgres conn database))))
         (is (= ["analyst" "NONE" "NONE"] @roles-set)))))))

(deftest postprocessing-binds-role-test
  (testing "the execution middleware binds the role recorded on the query while it runs"
    (let [qp (data-access.impersonation/apply-impersonation-postprocessing
              (fn [_query _rff] data-access.impersonation/*impersonation*))]
      (is (= {:db-id 1, :role "analyst"} (qp {:database 1, :impersonation/role "analyst"} nil)))
      (is (nil? (qp {:database 1} nil))))))
