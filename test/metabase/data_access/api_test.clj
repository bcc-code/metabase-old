(ns metabase.data-access.api-test
  "`/api/mt` endpoints, and keeping sandbox questions valid."
  (:require
   [clojure.test :refer :all]
   [metabase.data-access.test-util :as data-access.tu]
   [metabase.test :as mt]
   [toucan2.core :as t2]))

(set! *warn-on-reflection* true)

(deftest gtap-crud-test
  (mt/with-premium-features #{:sandboxes}
    (mt/with-temp [:model/PermissionsGroup {group-id :id} {}
                   :model/Card             {card-id :id}  {:dataset_query (mt/mbql-query venues {:fields [$id $name $category_id]})}]
      (testing "only admins may use the endpoints"
        (mt/user-http-request :rasta :get 403 "mt/gtap")
        (mt/user-http-request :rasta :post 403 "mt/gtap" {:group_id group-id, :table_id (mt/id :venues)}))
      (let [created (mt/user-http-request :crowberto :post 200 "mt/gtap"
                                          {:group_id             group-id
                                           :table_id             (mt/id :venues)
                                           :card_id              card-id
                                           :attribute_remappings {"cat" ["dimension" ["field" (mt/id :venues :category_id) nil]]}})]
        (is (=? {:id                   pos-int?
                 :group_id             group-id
                 :table_id             (mt/id :venues)
                 :card_id              card-id
                 :attribute_remappings {:cat ["dimension" ["field" (mt/id :venues :category_id) nil]]}
                 :permission_id        nil}
                created))
        (testing "GET with group_id and table_id returns that one sandbox, otherwise a list"
          (is (= created (mt/user-http-request :crowberto :get 200 "mt/gtap" :group_id group-id :table_id (mt/id :venues))))
          (is (= [created] (mt/user-http-request :crowberto :get 200 "mt/gtap" :group_id group-id)))
          (is (= created (mt/user-http-request :crowberto :get 200 (str "mt/gtap/" (:id created))))))
        (testing "attributes can be remapped onto a column by name"
          (is (=? {:attribute_remappings {:cat ["dimension" ["field" (mt/id :venues :name) nil]]}}
                  (mt/user-http-request :crowberto :put 200 (str "mt/gtap/" (:id created))
                                        {:attribute_remappings {"cat" "NAME"}}))))
        (testing "a column the question doesn't return is refused"
          (is (re-find #"isn't in the table or question"
                       (mt/user-http-request :crowberto :put 400 (str "mt/gtap/" (:id created))
                                             {:attribute_remappings {"cat" "PRICE"}}))))
        (mt/user-http-request :crowberto :delete 204 (str "mt/gtap/" (:id created)))
        (is (= [] (mt/user-http-request :crowberto :get 200 "mt/gtap" :group_id group-id)))))))

(deftest validate-test
  (testing "POST /api/mt/gtap/validate"
    (mt/with-temp [:model/Card {ok-card :id}  {:dataset_query (mt/mbql-query venues {:fields [$id $name]})}
                   :model/Card {bad-card :id} {:dataset_query (mt/mbql-query venues {:aggregation [[:count]]})}]
      (testing "a question returning only columns of the table is fine"
        (mt/user-http-request :crowberto :post 204 "mt/gtap/validate" {:table_id (mt/id :venues), :card_id ok-card}))
      (testing "a question returning other columns is refused"
        (is (re-find #"not a column of table"
                     (mt/user-http-request :crowberto :post 400 "mt/gtap/validate" {:table_id (mt/id :venues), :card_id bad-card}))))
      (testing "an attribute remapped onto a column the table doesn't have is refused"
        (is (re-find #"neither a column of the table nor a variable"
                     (mt/user-http-request :crowberto :post 400 "mt/gtap/validate"
                                           {:table_id (mt/id :venues), :attribute_remappings {"cat" "NOPE"}})))))))

(deftest user-attributes-test
  (testing "GET /api/mt/user/attributes lists the attribute names users have, without system attributes"
    (mt/with-temp [:model/User _ {:login_attributes {"region" "eu", "@tenant.slug" "x"}}
                   :model/User _ {:jwt_attributes {"department" "finance"}}]
      (let [attributes (set (mt/user-http-request :crowberto :get 200 "mt/user/attributes"))]
        (is (contains? attributes "region"))
        (is (contains? attributes "department"))
        (is (not (contains? attributes "@tenant.slug")))))
    (testing "admins only"
      (mt/user-http-request :rasta :get 403 "mt/user/attributes"))))

(deftest sandbox-question-constraints-test
  (testing "a question used by a sandbox"
    (mt/with-temp [:model/Card {card-id :id} {:dataset_query (mt/mbql-query venues {:fields [$id $name $category_id]})}]
      (data-access.tu/with-sandboxed-user! [_ {:attributes {"cat" "50"}
                                               :sandboxes  [{:table_id             (mt/id :venues)
                                                             :card_id              card-id
                                                             :attribute_remappings (data-access.tu/category-remapping "cat")}]}]
        (testing "can't be deleted, since that would delete the sandbox and lift the restriction"
          (is (thrown-with-msg? clojure.lang.ExceptionInfo #"used by row and column security"
                                (t2/delete! :model/Card card-id))))
        (testing "can't be changed to return columns the table doesn't have"
          (is (re-find #"used by row and column security"
                       (str (mt/user-http-request :crowberto :put 400 (str "card/" card-id)
                                                  {:dataset_query (mt/mbql-query venues {:aggregation [[:count]]})})))))
        (testing "can be changed in ways that keep it valid"
          (mt/user-http-request :crowberto :put 200 (str "card/" card-id)
                                {:dataset_query (mt/mbql-query venues {:fields [$id $category_id]})}))))))

(deftest impersonation-list-test
  (testing "GET /api/mt/impersonation lists policies, optionally of one group on one database"
    (mt/with-temp [:model/Database                {db-id :id}    {:engine :postgres}
                   :model/PermissionsGroup        {group-id :id} {}
                   :model/ConnectionImpersonation {policy-id :id} {:group_id group-id, :db_id db-id, :attribute "db_role"}]
      (is (= [{:id policy-id, :group_id group-id, :db_id db-id, :attribute "db_role"}]
             (mt/user-http-request :crowberto :get 200 "mt/impersonation" :group-id group-id :db-id db-id)))
      (is (= [] (mt/user-http-request :crowberto :get 200 "mt/impersonation" :group-id group-id :db-id (mt/id))))
      (mt/user-http-request :rasta :get 403 "mt/impersonation"))))
