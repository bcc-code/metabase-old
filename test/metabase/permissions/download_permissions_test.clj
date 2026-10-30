(ns metabase.permissions.download-permissions-test
  "Tests for download permissions: who may export query results, and how many rows they get."
  (:require
   [clojure.data.csv :as csv]
   [clojure.java.io :as io]
   [clojure.test :refer :all]
   [metabase.channel.email.result-attachment :as email.result-attachment]
   [metabase.permissions.advanced-test-util :as advanced-test-util]
   [metabase.permissions.core :as perms]
   [metabase.permissions.models.data-permissions :as data-perms]
   [metabase.query-processor :as qp]
   [metabase.test :as mt]
   [metabase.test.fixtures :as fixtures]
   [metabase.util :as u]))

(use-fixtures :once (fixtures/initialize :db :test-users))

(defn- do-with-download-perms!
  "Run `f` with the All Users group allowed to query and see the test database, and with the download permissions
  in `table->level`, a map of table name keyword (or `:db` for the whole database) to download permission value."
  [table->level f]
  (advanced-test-util/with-advanced-permissions
    (mt/with-no-data-perms-for-all-users!
      (let [all-users (perms/all-users-group)]
        (perms/set-database-permission! all-users (mt/id) :perms/view-data :unrestricted)
        (perms/set-database-permission! all-users (mt/id) :perms/create-queries :query-builder-and-native)
        (perms/set-database-permission! all-users (mt/id) :perms/download-results (get table->level :db :no))
        (doseq [[table level] (dissoc table->level :db)]
          (perms/set-table-permission! all-users (mt/id table) :perms/download-results level))
        (f)))))

(defmacro ^:private with-download-perms!
  [table->level & body]
  `(do-with-download-perms! ~table->level (fn [] ~@body)))

(defn- csv-row-count [csv-string]
  (dec (count (csv/read-csv csv-string))))

(defn- download-card [user card export-format expected-status]
  (mt/user-http-request user :post expected-status (format "card/%d/query/%s" (u/the-id card) (name export-format))))

(deftest card-download-test
  (mt/with-temp [:model/Card card {:dataset_query (mt/mbql-query venues {:order-by [[:asc $id]]})}]
    (testing "without download permissions every export format is refused"
      (with-download-perms! {:venues :no}
        (doseq [export-format [:csv :json]]
          (testing export-format
            (is (=? {:error_type "missing-required-permissions"}
                    (download-card :rasta card export-format 403)))))
        (download-card :rasta card :xlsx 403)
        (testing "admins can always download"
          (is (= 100 (csv-row-count (download-card :crowberto card :csv 200)))))))
    (testing "with full download permissions every row is exported"
      (with-download-perms! {:venues :one-million-rows}
        (is (= 100 (csv-row-count (download-card :rasta card :csv 200))))
        (is (= 100 (count (download-card :rasta card :json 200))))
        (download-card :rasta card :xlsx 200)))
    (testing "with limited download permissions exports are cut down to the limit"
      (with-redefs [data-perms/limited-download-row-limit 10]
        (with-download-perms! {:venues :ten-thousand-rows}
          (is (= 10 (csv-row-count (download-card :rasta card :csv 200))))
          (is (= 10 (count (download-card :rasta card :json 200))))
          (download-card :rasta card :xlsx 200)
          (testing "running the question still shows every row"
            (is (= 100 (:row_count (mt/user-http-request :rasta :post 202 (format "card/%d/query" (u/the-id card))))))))))))

(deftest download-perms-in-query-results-test
  (testing "query results tell the frontend whether the user may download them"
    (mt/with-temp [:model/Card card {:dataset_query (mt/mbql-query venues)}]
      (doseq [[level expected] [[:no "none"] [:ten-thousand-rows "limited"] [:one-million-rows "full"]]]
        (with-download-perms! {:venues level}
          (is (= expected
                 (get-in (mt/user-http-request :rasta :post 202 (format "card/%d/query" (u/the-id card)))
                         [:data :download_perms]))))))))

(deftest ad-hoc-and-native-download-test
  (testing "POST /api/dataset/:export-format"
    (let [download (fn [query expected-status]
                     (mt/user-http-request :rasta :post expected-status "dataset/csv"
                                           {:query query}))]
      (testing "the most restrictive permission of the tables a query reads applies"
        (with-download-perms! {:venues :one-million-rows, :categories :no}
          (is (= 100 (csv-row-count (download (mt/mbql-query venues) 200))))
          (download (mt/mbql-query venues {:joins [{:source-table $$categories
                                                    :alias        "c"
                                                    :condition    [:= $category_id &c.categories.id]
                                                    :fields       :all}]})
                    403)))
      (testing "native queries need download permission for every table of the database"
        (let [native-query (mt/native-query {:query "SELECT * FROM VENUES ORDER BY ID"})]
          (with-download-perms! {:db :one-million-rows, :categories :no}
            (download native-query 403))
          (with-download-perms! {:db :one-million-rows}
            (is (= 100 (csv-row-count (download native-query 200)))))
          (testing "and are cut down to the limit for limited permissions"
            (with-redefs [data-perms/limited-download-row-limit 10]
              (with-download-perms! {:db :ten-thousand-rows}
                (is (= 10 (csv-row-count (download native-query 200))))))))))))

(deftest most-permissive-group-wins-test
  (testing "a user gets the most permissive download permission any of their groups holds"
    (mt/with-temp [:model/Card card {:dataset_query (mt/mbql-query venues)}]
      (with-download-perms! {:venues :no}
        (mt/with-user-in-groups [group {:name "Downloaders"}
                                 user  [group]]
          (download-card user card :csv 403)
          (perms/set-table-permission! group (mt/id :venues) :perms/download-results :one-million-rows)
          (is (= 100 (csv-row-count (download-card user card :csv 200)))))))))

(deftest dashboard-download-test
  (mt/with-temp [:model/Card          {card-id :id}     {:dataset_query (mt/mbql-query venues)}
                 :model/Dashboard     {dashboard-id :id} {}
                 :model/DashboardCard {dashcard-id :id} {:dashboard_id dashboard-id :card_id card-id}]
    (let [url (format "dashboard/%d/dashcard/%d/card/%d/query/csv" dashboard-id dashcard-id card-id)]
      (with-download-perms! {:venues :no}
        (mt/user-http-request :rasta :post 403 url)
        (testing "the dashboard tells the frontend the card can't be downloaded"
          (is (= "none" (-> (mt/user-http-request :rasta :get 200 (str "dashboard/" dashboard-id))
                            :dashcards first :card :download_perms)))))
      (with-download-perms! {:venues :one-million-rows}
        (is (= 100 (csv-row-count (mt/user-http-request :rasta :post 200 url))))))))

(deftest public-link-download-test
  (testing "public links aren't bound by group download permissions"
    (mt/with-temporary-setting-values [enable-public-sharing true]
      (mt/with-temp [:model/Card card {:dataset_query (mt/mbql-query venues)
                                       :public_uuid   (str (random-uuid))}]
        (with-download-perms! {:venues :no}
          (is (= 100 (csv-row-count (mt/client :get 200 (str "public/card/" (:public_uuid card) "/query/csv"))))))))))

(defn- attachment-row-count [attachments]
  (when-let [{:keys [content]} (first attachments)]
    (with-open [reader (io/reader content)]
      (dec (count (csv/read-csv reader))))))

(deftest subscription-attachment-test
  (testing "attachments follow the download permissions of the subscription's creator"
    (let [query  (mt/mbql-query venues)
          result (-> (mt/with-current-user (mt/user->id :crowberto)
                       (qp/process-query query))
                     (assoc :database_id (mt/id)))
          part   {:card   {:include_csv true :dataset_query query :name "Venues"}
                  :result result}]
      (with-download-perms! {:venues :no}
        (is (nil? (email.result-attachment/result-attachment part (mt/user->id :rasta))))
        (is (= 100 (attachment-row-count (email.result-attachment/result-attachment part (mt/user->id :crowberto))))))
      (with-redefs [data-perms/limited-download-row-limit 10]
        (with-download-perms! {:venues :ten-thousand-rows}
          (is (= 10 (attachment-row-count (email.result-attachment/result-attachment part (mt/user->id :rasta))))))))))

(deftest download-perms-level-test
  (testing "without the advanced-permissions feature downloads are unrestricted"
    (advanced-test-util/without-advanced-permissions
      (is (= :full (perms/download-perms-level (mt/mbql-query venues) (mt/user->id :rasta))))))
  (with-download-perms! {:venues :ten-thousand-rows, :checkins :no}
    (is (= :ten-thousand-rows (perms/download-perms-level (mt/mbql-query venues) (mt/user->id :rasta))))
    (is (= :no (perms/download-perms-level (mt/mbql-query checkins) (mt/user->id :rasta))))
    (is (= :one-million-rows (perms/download-perms-level (mt/mbql-query checkins) (mt/user->id :crowberto))))
    (testing "a question built on a native question needs the database-wide permission"
      (mt/with-temp [:model/Card {native-card-id :id} {:dataset_query (mt/native-query {:query "SELECT * FROM VENUES"})}]
        (is (= :no (perms/download-perms-level {:database (mt/id)
                                                :type     :query
                                                :query    {:source-table (str "card__" native-card-id)}}
                                               (mt/user->id :rasta))))))))
