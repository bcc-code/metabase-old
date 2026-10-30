(ns metabase.data-access.query-processor-test
  "Row and column security (sandboxing) as the query processor applies it."
  (:require
   [clojure.test :refer :all]
   [metabase.data-access.test-util :as data-access.tu]
   [metabase.permissions.core :as perms]
   [metabase.permissions.models.data-permissions :as data-perms]
   [metabase.query-processor :as qp]
   [metabase.query-processor.compile :as qp.compile]
   [metabase.test :as mt]
   [metabase.warehouse-schema.table :as schema.table]
   [toucan2.core :as t2]))

(set! *warn-on-reflection* true)

(defn- venues-count
  "A count of the venues. A function, since resolving test data IDs while the namespace loads isn't allowed."
  []
  (mt/mbql-query venues {:aggregation [[:count]]}))

(defn- query-error
  "The message of the error running `query` as `user-id` throws, or nil."
  [user-id query]
  (try
    (data-access.tu/rows-as user-id query)
    nil
    (catch clojure.lang.ExceptionInfo e
      (str (ex-message e) " " (some-> (ex-cause e) ex-message)))))

(deftest attribute-row-filter-test
  (testing "a sandbox on a table filters its rows by the user's attribute"
    (data-access.tu/with-sandboxed-user! [{:keys [user-id]} {:attributes {"cat" "50"}
                                                             :sandboxes  [{:table_id             (mt/id :venues)
                                                                           :attribute_remappings (data-access.tu/category-remapping "cat")}]}]
      (is (= [[10]] (data-access.tu/rows-as user-id (venues-count))))
      (is (= #{50} (into #{} (map last) (data-access.tu/rows-as user-id (mt/mbql-query venues {:fields [$id $category_id]})))))
      (testing "results are marked as sandboxed"
        (mt/with-current-user user-id
          (let [result (qp/process-query (venues-count))]
            (is (true? (get-in result [:data :is_sandboxed]))))))
      (testing "admins are unaffected"
        (is (= [[100]] (mt/rows (mt/with-test-user :crowberto (qp/process-query (venues-count)))))))
      (testing "the sandbox applies through implicit joins: hidden venues have no category"
        (is (= [[nil 911] [50 89]]
               (data-access.tu/rows-as user-id (mt/mbql-query checkins {:aggregation [[:count]]
                                                                        :breakout    [$venue_id->venues.category_id]})))))
      (testing "the sandbox applies to explicit joins"
        (is (= [[89]]
               (data-access.tu/rows-as user-id (mt/mbql-query checkins
                                                 {:aggregation [[:count]]
                                                  :joins       [{:source-table (mt/id :venues)
                                                                 :alias        "v"
                                                                 :condition    [:= $venue_id &v.venues.id]
                                                                 :strategy     :inner-join}]}))))))))

(deftest attribute-multiple-values-test
  (testing "an attribute holding a list of values allows rows matching any of them"
    (data-access.tu/with-sandboxed-user! [{:keys [user-id]} {:attributes {"cat" ["50" "40"]}
                                                             :sandboxes  [{:table_id             (mt/id :venues)
                                                                           :attribute_remappings (data-access.tu/category-remapping "cat")}]}]
      (is (= #{40 50} (into #{} (map last) (data-access.tu/rows-as user-id (mt/mbql-query venues {:fields [$id $category_id]}))))))))

(deftest missing-attribute-test
  (testing "a user without the attribute a sandbox needs can't query the table at all"
    (data-access.tu/with-sandboxed-user! [{:keys [user-id]} {:attributes {}
                                                             :sandboxes  [{:table_id             (mt/id :venues)
                                                                           :attribute_remappings (data-access.tu/category-remapping "cat")}]}]
      (is (re-find #"requires the user attribute \"cat\"" (query-error user-id (venues-count)))))))

(deftest native-queries-denied-test
  (testing "a sandboxed user can't run native queries on the database, even if a group grants native access"
    (data-access.tu/with-sandboxed-user! [{:keys [user-id group-id]} {:attributes {"cat" "50"}
                                                                      :sandboxes  [{:table_id             (mt/id :venues)
                                                                                    :attribute_remappings (data-access.tu/category-remapping "cat")}]}]
      (data-perms/set-database-permission! group-id (mt/id) :perms/create-queries :query-builder-and-native)
      (is (some? (query-error user-id (mt/native-query {:query "SELECT COUNT(*) FROM VENUES"}))))
      (testing "nor see the compiled SQL of their queries, which would show the sandbox"
        (mt/with-current-user user-id
          (is (perms/sandboxed-user-for-db? (mt/id)))
          (let [result (qp/process-query (assoc (venues-count) :info {:context :ad-hoc}))]
            (is (nil? (get-in result [:data :native_form])))))))))

(deftest saved-native-question-denied-test
  (testing "a sandboxed user can't run a saved native question on the database, even one they can read"
    (data-access.tu/with-sandboxed-user! [{:keys [user-id]} {:attributes {"cat" "50"}
                                                             :sandboxes  [{:table_id             (mt/id :venues)
                                                                           :attribute_remappings (data-access.tu/category-remapping "cat")}]}]
      (mt/with-temp [:model/Card {card-id :id} {:dataset_query (mt/native-query {:query "SELECT COUNT(*) FROM VENUES"})}]
        (is (re-find #"row and column security"
                     (str (mt/user-http-request user-id :post 403 (format "card/%d/query" card-id)))))
        (testing "while an admin can"
          (is (= [[100]] (mt/rows (mt/user-http-request :crowberto :post 202 (format "card/%d/query" card-id))))))))))

(deftest saved-questions-and-models-test
  (testing "saved questions and models on a sandboxed table are sandboxed too"
    (data-access.tu/with-sandboxed-user! [{:keys [user-id]} {:attributes {"cat" "50"}
                                                             :sandboxes  [{:table_id             (mt/id :venues)
                                                                           :attribute_remappings (data-access.tu/category-remapping "cat")}]}]
      (mt/with-temp [:model/Card {question-id :id} {:dataset_query (mt/mbql-query venues)}
                     :model/Card {model-id :id}    {:type :model, :dataset_query (mt/mbql-query venues)}
                     :model/Card {nested-id :id}   {:dataset_query (mt/mbql-query nil {:source-table (str "card__" model-id)
                                                                                       :aggregation  [[:count]]})}]
        (is (= 10 (count (mt/rows (mt/user-http-request user-id :post 202 (format "card/%d/query" question-id))))))
        (is (= 10 (count (mt/rows (mt/user-http-request user-id :post 202 (format "card/%d/query" model-id))))))
        (is (= [[10]] (mt/rows (mt/user-http-request user-id :post 202 (format "card/%d/query" nested-id)))))
        (testing "admins see everything"
          (is (= [[100]] (mt/rows (mt/user-http-request :crowberto :post 202 (format "card/%d/query" nested-id))))))))))

(deftest question-row-and-column-security-test
  (testing "a sandbox with an MBQL question restricts rows and columns"
    (mt/with-temp [:model/Card {card-id :id} {:dataset_query (mt/mbql-query venues {:fields [$id $name $category_id]
                                                                                    :filter [:< $price 3]})}]
      (data-access.tu/with-sandboxed-user! [{:keys [user-id]} {:attributes {"cat" "50"}
                                                               :sandboxes  [{:table_id             (mt/id :venues)
                                                                             :card_id              card-id
                                                                             :attribute_remappings (data-access.tu/category-remapping "cat")}]}]
        (is (= [[10]] (data-access.tu/rows-as user-id (venues-count))))
        (mt/with-current-user user-id
          (let [cols (mt/cols (qp/process-query (mt/mbql-query venues {:limit 1})))]
            (is (= ["ID" "NAME" "CATEGORY_ID"] (map :name cols)))
            (is (= [(mt/id :venues :id) (mt/id :venues :name) (mt/id :venues :category_id)] (map :id cols))))
          (testing "the table's metadata only lists the columns of the question"
            (is (= #{"ID" "NAME" "CATEGORY_ID"}
                   (into #{} (map :name) (:fields (schema.table/fetch-table-query-metadata (mt/id :venues) {}))))))
          (testing "the sandbox question's SQL restricts the rows"
            (is (re-find #"\"PRICE\" < 3" (:query (qp.compile/compile (venues-count)))))))
        (testing "a column the question leaves out is dropped from the results"
          (is (= [[22]] (data-access.tu/rows-as user-id (mt/mbql-query venues {:fields [$id $price]
                                                                               :filter [:= $id 22]})))))
        (testing "and can't be filtered or grouped on"
          (is (re-find #"permission to see one of the columns" (query-error user-id (mt/mbql-query venues {:aggregation [[:count]]
                                                                                                         :filter      [:= $price 1]}))))
          (is (re-find #"permission to see one of the columns" (query-error user-id (mt/mbql-query venues {:aggregation [[:count]]
                                                                                                         :breakout    [$price]})))))))))

(deftest native-question-sandbox-test
  (testing "a sandbox with a native question, the user attribute passed as a variable"
    (let [query (mt/native-query {:query         "SELECT ID, NAME, CATEGORY_ID FROM VENUES WHERE CATEGORY_ID = {{cat}}"
                                  :template-tags {"cat" {:id "cat", :name "cat", :display-name "Cat", :type :number}}})]
      (mt/with-temp [:model/Card {card-id :id} {:dataset_query   query
                                                :result_metadata (data-access.tu/native-card-result-metadata
                                                                  query
                                                                  [{:type   :number/=
                                                                    :target [:variable [:template-tag "cat"]]
                                                                    :value  [50]}])}]
        (data-access.tu/with-sandboxed-user! [{:keys [user-id]} {:attributes {"cat" "50"}
                                                                 :sandboxes  [{:table_id             (mt/id :venues)
                                                                               :card_id              card-id
                                                                               :attribute_remappings {"cat" [:variable [:template-tag "cat"]]}}]}]
          (is (= [[10]] (data-access.tu/rows-as user-id (venues-count))))
          (testing "results keep the table's column metadata"
            (mt/with-current-user user-id
              (let [cols (mt/cols (qp/process-query (mt/mbql-query venues {:limit 1})))]
                (is (= [(mt/id :venues :id) (mt/id :venues :name) (mt/id :venues :category_id)] (map :id cols)))
                (is (= ["ID" "Name" "Category ID"] (map :display_name cols))))))
          (testing "the native question doesn't need native query permissions"
            (is (= [[10]] (data-access.tu/rows-as user-id (venues-count))))))))))

(deftest conflicting-sandboxes-test
  (testing "a user in two groups with different sandboxes on a table can't query it"
    (data-access.tu/with-sandboxed-user! [{:keys [user-id]} {:attributes {"cat" "50", "price" "1"}
                                                             :sandboxes  [{:table_id             (mt/id :venues)
                                                                           :attribute_remappings (data-access.tu/category-remapping "cat")}]}]
      (mt/with-temp [:model/PermissionsGroup           {other-group :id} {}
                     :model/PermissionsGroupMembership _                 {:group_id other-group, :user_id user-id}]
        (data-perms/set-database-permission! other-group (mt/id) :perms/view-data :unrestricted)
        (testing "identical policies are fine"
          (mt/with-temp [:model/Sandbox _ {:group_id             other-group
                                           :table_id             (mt/id :venues)
                                           :attribute_remappings (data-access.tu/category-remapping "cat")}]
            (is (= [[10]] (data-access.tu/rows-as user-id (venues-count))))))
        (testing "different ones are an error"
          (mt/with-temp [:model/Sandbox _ {:group_id             other-group
                                           :table_id             (mt/id :venues)
                                           :attribute_remappings {"price" [:dimension [:field (mt/id :venues :price) nil]]}}]
            (is (re-find #"different row and column security policies" (query-error user-id (venues-count))))))))))

(deftest unrestricted-group-overrides-sandbox-test
  (testing "a user also in a group with unrestricted access to the table isn't sandboxed"
    (data-access.tu/with-sandboxed-user! [{:keys [user-id]} {:attributes {"cat" "50"}
                                                             :sandboxes  [{:table_id             (mt/id :venues)
                                                                           :attribute_remappings (data-access.tu/category-remapping "cat")}]}]
      (mt/with-temp [:model/PermissionsGroup           {other-group :id} {}
                     :model/PermissionsGroupMembership _                 {:group_id other-group, :user_id user-id}]
        (testing "a group with only blocked access doesn't override it"
          (data-perms/set-database-permission! other-group (mt/id) :perms/view-data :blocked)
          (is (= [[10]] (data-access.tu/rows-as user-id (venues-count)))))
        (data-perms/set-database-permission! other-group (mt/id) :perms/view-data :unrestricted)
        (is (= [[100]] (data-access.tu/rows-as user-id (venues-count))))))))

(deftest field-values-test
  (testing "field values are computed under the sandbox"
    (data-access.tu/with-sandboxed-user! [{:keys [user-id]} {:attributes {"cat" "50"}
                                                             :sandboxes  [{:table_id             (mt/id :venues)
                                                                           :attribute_remappings (data-access.tu/category-remapping "cat")}]}]
      (let [values         #(set (map first (:values (mt/user-http-request % :get 200 (format "field/%d/values" (mt/id :venues :price))))))
            category-50-prices (set (map first (mt/rows (mt/run-mbql-query venues {:breakout [$price]
                                                                                   :filter   [:= $category_id 50]}))))]
        (is (= category-50-prices (values user-id)))
        (testing "and kept apart from unsandboxed users' values"
          (is (= #{1 2 3 4} (values :crowberto)))
          (is (= category-50-prices (values user-id))))))))

(deftest data-access-token-test
  (testing "users with different attribute values get different data access tokens, so cached results aren't shared"
    (data-access.tu/with-sandboxed-user! [{user-1 :user-id group-id :group-id} {:attributes {"cat" "50"}
                                                                                :sandboxes  [{:table_id             (mt/id :venues)
                                                                                              :attribute_remappings (data-access.tu/category-remapping "cat")}]}]
      (mt/with-temp [:model/User                       {user-2 :id} {:login_attributes {"cat" "40"}}
                     :model/PermissionsGroupMembership _            {:group_id group-id, :user_id user-2}]
        (let [token (fn [user-id]
                      (mt/with-current-user user-id
                        (perms/data-access-token {:database-id (mt/id), :table-ids [(mt/id :venues)]})))]
          (is (contains? (token user-1) :sandbox))
          (is (not= (token user-1) (token user-2)))
          (is (= {} (mt/with-test-user :rasta
                      (perms/data-access-token {:database-id (mt/id), :table-ids [(mt/id :venues)]})))))))))

(deftest new-tables-in-sandboxed-database-are-blocked-test
  (testing "a table added to a database where a group has a sandbox is blocked for that group"
    (data-access.tu/with-sandboxed-user! [{:keys [group-id]} {:attributes {"cat" "50"}
                                                              :sandboxes  [{:table_id             (mt/id :venues)
                                                                            :attribute_remappings (data-access.tu/category-remapping "cat")}]}]
      (mt/with-temp [:model/Table {table-id :id} {:db_id (mt/id), :schema "PUBLIC", :name "new_table"}]
        (is (= :blocked (t2/select-one-fn :perm_value :model/DataPermissions
                                          :group_id group-id :table_id table-id :perm_type :perms/view-data)))))))

(deftest native-question-with-column-remapping-test
  (testing "an attribute remapped onto a column of a native question filters its rows (not ignored as a parameter)"
    (let [query (mt/native-query {:query "SELECT ID, NAME, CATEGORY_ID FROM VENUES"})]
      (mt/with-temp [:model/Card {card-id :id} {:dataset_query   query
                                                :result_metadata (data-access.tu/native-card-result-metadata query [])}]
        (data-access.tu/with-sandboxed-user! [{:keys [user-id]} {:attributes {"cat" "50"}
                                                                 :sandboxes  [{:table_id             (mt/id :venues)
                                                                               :card_id              card-id
                                                                               :attribute_remappings (data-access.tu/category-remapping "cat")}]}]
          (is (= [[10]] (data-access.tu/rows-as user-id (venues-count)))))))))
