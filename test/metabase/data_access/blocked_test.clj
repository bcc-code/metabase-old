(ns metabase.data-access.blocked-test
  "Blocked view-data access: a blocked table can't be read even through saved questions the user can see."
  (:require
   [clojure.test :refer :all]
   [metabase.permissions.models.data-permissions :as data-perms]
   [metabase.permissions.test-util :as perms.test-util]
   [metabase.test :as mt]
   [toucan2.core :as t2]))

(set! *warn-on-reflection* true)

(defn- do-with-venues-blocked-user! [f]
  (perms.test-util/with-no-data-perms-for-all-users!
    (mt/with-temp [:model/PermissionsGroup           {group-id :id} {}
                   :model/User                       {user-id :id}  {}
                   :model/PermissionsGroupMembership _              {:group_id group-id, :user_id user-id}]
      (data-perms/set-database-permission! group-id (mt/id) :perms/view-data :unrestricted)
      (data-perms/set-database-permission! group-id (mt/id) :perms/create-queries :query-builder)
      (data-perms/set-table-permission! group-id (mt/id :venues) :perms/view-data :blocked)
      (f {:user-id user-id, :group-id group-id}))))

(deftest blocked-table-test
  (do-with-venues-blocked-user!
   (fn [{:keys [user-id]}]
     (mt/with-temp [:model/Card {venues-card :id}   {:dataset_query (mt/mbql-query venues {:aggregation [[:count]]})}
                    :model/Card {checkins-card :id} {:dataset_query (mt/mbql-query checkins {:aggregation [[:count]]})}
                    :model/Card {model-id :id}      {:type :model, :dataset_query (mt/mbql-query venues)}
                    :model/Card {on-model :id}      {:dataset_query (mt/mbql-query nil {:source-table (str "card__" model-id)
                                                                                         :aggregation  [[:count]]})}
                    :model/Card {native-card :id}   {:dataset_query (mt/native-query {:query "SELECT COUNT(*) FROM CHECKINS"})}]
       (testing "a saved question on a blocked table can't be run, even though its collection can be read"
         (is (re-find #"You do not have permissions to run this query"
                      (str (mt/user-http-request user-id :post 403 (format "card/%d/query" venues-card))))))
       (testing "nor a question built on a model of the blocked table"
         (mt/user-http-request user-id :post 403 (format "card/%d/query" on-model)))
       (testing "nor a native question on the database"
         (mt/user-http-request user-id :post 403 (format "card/%d/query" native-card)))
       (testing "questions on tables that aren't blocked still run"
         (is (= [[1000]] (mt/rows (mt/user-http-request user-id :post 202 (format "card/%d/query" checkins-card))))))
       (testing "admins are unaffected"
         (is (= [[100]] (mt/rows (mt/user-http-request :crowberto :post 202 (format "card/%d/query" venues-card))))))))))

(deftest new-table-default-test
  (testing "a table added to a database where a group is blocked from some tables is blocked for that group"
    (do-with-venues-blocked-user!
     (fn [{:keys [group-id]}]
       (mt/with-temp [:model/PermissionsGroup {open-group :id} {}]
         (data-perms/set-database-permission! open-group (mt/id) :perms/view-data :unrestricted)
         (mt/with-temp [:model/Table {table-id :id} {:db_id (mt/id), :schema "PUBLIC", :name "brand_new"}]
           (is (= :blocked (data-perms/table-permission-for-groups #{group-id} :perms/view-data (mt/id) table-id)))
           (testing "a group with access to the whole database keeps it"
             (is (= :unrestricted (data-perms/table-permission-for-groups #{open-group} :perms/view-data (mt/id) table-id))))
           (is (t2/exists? :model/Table :id table-id))))))))
