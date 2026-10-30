(ns metabase.cache.refresh.core-test
  (:require
   [buddy.core.codecs :as codecs]
   [clojure.test :refer :all]
   [java-time.api :as t]
   [metabase.cache.refresh.core :as cache.refresh]
   [metabase.test :as mt]
   [toucan2.core :as t2])
  (:import
   (java.sql Blob)))

(set! *warn-on-reflection* true)

(defn- hex
  "A query hash as hex, whether the app DB returned it as bytes or as a BLOB."
  [hash-value]
  (some-> (if (instance? Blob hash-value)
            (let [^Blob blob hash-value]
              (.getBytes blob 1 (int (.length blob))))
            hash-value)
          codecs/bytes->hex))

(def ^:private price-card
  "A native question with a `price` parameter."
  {:dataset_query (mt/native-query {:query         "SELECT count(*) AS n FROM venues WHERE price = {{price}}"
                                    :template-tags {"price" {:id "price" :name "price" :display-name "Price" :type :number}}})
   :parameters    [{:id "price" :type :number/= :slug "price" :name "Price" :target [:variable [:template-tag "price"]]}]})

(defn- price-parameters [price]
  [{:id "price" :type "number/=" :value [price] :target ["variable" ["template-tag" "price"]]}])

(defn- run-card! [card-id price]
  (mt/user-http-request :crowberto :post 202 (format "card/%d/query" card-id) {:parameters (price-parameters price)}))

(defn- run-dashcard! [dashboard-id dashcard-id card-id price]
  (mt/user-http-request :crowberto :post 202
                        (format "dashboard/%d/dashcard/%d/card/%d/query" dashboard-id dashcard-id card-id)
                        {:parameters [{:id "price" :type "number/=" :value [price]
                                       :target ["variable" ["template-tag" "price"]]}]}))

(defn- store-policy! [model model-id strategy]
  (mt/user-http-request :crowberto :put 200 "cache/" {:model model :model_id model-id :strategy strategy}))

(def ^:private hourly-refreshed {:type "duration" :duration 1 :unit "hours" :refresh_automatically true})

(defn- executions
  "The query executions of the Card with `card-id`, oldest first, with their hashes as hex."
  [card-id]
  (for [qe (t2/select [:model/QueryExecution :context :hash :cache_hash :dashboard_id]
                      :card_id card-id {:order-by [[:id :asc]]})]
    (-> qe
        (update :hash hex)
        (update :cache_hash hex))))

(defn- refreshes [card-id]
  (filter #(= :cache-refresh (:context %)) (executions card-id)))

(defmacro ^:private with-cleanup [& body]
  `(mt/with-temporary-setting-values [~'synchronous-batch-updates true]
     (mt/with-model-cleanup [:model/CacheConfig :model/QueryExecution :model/QueryCache :model/Query]
       ~@body)))

(deftest refresh-question-test
  (with-cleanup
    (mt/with-temp [:model/Card {card-id :id} price-card]
      (store-policy! "question" card-id hourly-refreshed)
      (run-card! card-id 1)
      (run-card! card-id 1)
      (run-card! card-id 2)
      (testing "Each combination of parameter values people applied is run again"
        (is (= {:policies_refreshed 1, :queries_refreshed 2, :queries_failed 0}
               (cache.refresh/refresh-due-caches!))))
      (testing "...under the same hashes and cache keys as people's runs, so that they are served from the cache"
        (let [{runs :question, refreshes :cache-refresh} (group-by :context (executions card-id))]
          (is (= (set (map (juxt :hash :cache_hash) runs))
                 (set (map (juxt :hash :cache_hash) refreshes))))
          (is (some? (:cached (run-card! card-id 2))))))
      (testing "Nothing is due again until the results go stale"
        (is (= {:policies_refreshed 0, :queries_refreshed 0, :queries_failed 0}
               (cache.refresh/refresh-due-caches!))))
      (testing "Clearing the cache makes a refresh due; with no runs since the last refresh, the last run is repeated"
        (mt/user-http-request :crowberto :post 200 "cache/invalidate" :question card-id)
        (let [before (count (refreshes card-id))]
          (is (= {:policies_refreshed 1, :queries_refreshed 1, :queries_failed 0}
                 (cache.refresh/refresh-due-caches!)))
          (is (= (:hash (last (filter #(= :question (:context %)) (executions card-id))))
                 (:hash (last (refreshes card-id)))))
          (is (= (inc before) (count (refreshes card-id)))))))))

(deftest refresh-when-schedule-fires-test
  (with-cleanup
    (mt/with-temporary-setting-values [report-timezone "UTC"]
      (mt/with-temp [:model/Card {card-id :id} price-card]
        (store-policy! "question" card-id {:type "schedule" :schedule "0 0 * * * ? *" :refresh_automatically true})
        (run-card! card-id 1)
        (is (=? {:queries_refreshed 1} (cache.refresh/refresh-due-caches!)))
        (testing "Nothing is due until the schedule fires"
          (is (=? {:queries_refreshed 0} (cache.refresh/refresh-due-caches!))))
        (testing "Once it fires, its run is recorded and the results are refreshed"
          ;; as if the results were refreshed an hour ago, and the schedule fired half an hour ago
          (let [an-hour-ago (t/minus (t/offset-date-time) (t/hours 1))]
            (t2/update! :model/CacheConfig {:model "question" :model_id card-id}
                        {:state          {:last_refreshed_at (str an-hour-ago)}
                         :invalidated_at (t/minus an-hour-ago (t/minutes 1))
                         :next_run_at    (t/plus an-hour-ago (t/minutes 30))}))
          (is (=? {:queries_refreshed 1} (cache.refresh/refresh-due-caches!)))
          (is (t/after? (t/instant (t2/select-one-fn :next_run_at :model/CacheConfig :model "question" :model_id card-id))
                        (t/instant)))
          (is (=? {:queries_refreshed 0} (cache.refresh/refresh-due-caches!))))))))

(deftest refresh-only-when-turned-on-test
  (with-cleanup
    (mt/with-temp [:model/Card {card-id :id} price-card]
      (store-policy! "question" card-id (assoc hourly-refreshed :refresh_automatically false))
      (run-card! card-id 1)
      (is (= {:policies_refreshed 0, :queries_refreshed 0, :queries_failed 0}
             (cache.refresh/refresh-due-caches!)))
      (is (empty? (refreshes card-id))))))

(deftest refresh-dashboard-test
  (with-cleanup
    (mt/with-temp [:model/Card      {card-id :id}       price-card
                   :model/Card      {own-card-id :id}   price-card
                   :model/Card      {other-card-id :id} price-card
                   :model/Dashboard {dashboard-id :id}  {:parameters [{:id "price" :slug "price" :name "Price"
                                                                        :type :number/=}]}
                   :model/DashboardCard {dashcard-id :id} {:dashboard_id       dashboard-id
                                                           :card_id            card-id
                                                           :parameter_mappings [{:parameter_id "price"
                                                                                 :card_id      card-id
                                                                                 :target       [:variable [:template-tag "price"]]}]}
                   :model/DashboardCard {own-dashcard-id :id} {:dashboard_id       dashboard-id
                                                               :card_id            own-card-id
                                                               :parameter_mappings [{:parameter_id "price"
                                                                                     :card_id      own-card-id
                                                                                     :target       [:variable [:template-tag "price"]]}]}]
      (store-policy! "dashboard" dashboard-id hourly-refreshed)
      (store-policy! "question" own-card-id {:type "nocache"})
      (run-dashcard! dashboard-id dashcard-id card-id 1)
      (run-dashcard! dashboard-id dashcard-id card-id 3)
      (run-dashcard! dashboard-id own-dashcard-id own-card-id 1)
      (run-card! other-card-id 1)
      (testing "The dashboard's cards are run again with the filter values applied on it, except a card with a policy of its own"
        (is (= {:policies_refreshed 1, :queries_refreshed 2, :queries_failed 0}
               (cache.refresh/refresh-due-caches!)))
        (is (= #{dashboard-id} (set (map :dashboard_id (refreshes card-id)))))
        (is (= (set (map (juxt :hash :cache_hash) (filter #(= :dashboard (:context %)) (executions card-id))))
               (set (map (juxt :hash :cache_hash) (refreshes card-id)))))
        (is (empty? (refreshes own-card-id)))
        (is (empty? (refreshes other-card-id))))
      (testing "The refreshed results are served on the dashboard"
        (is (some? (:cached (run-dashcard! dashboard-id dashcard-id card-id 3))))))))

(deftest skip-databases-with-per-person-results-test
  (testing "Questions on a database with row and column security aren't refreshed: there's no one result to keep warm"
    (with-cleanup
      (mt/with-temp [:model/Card             {card-id :id}  price-card
                     :model/PermissionsGroup {group-id :id} {}
                     :model/Sandbox          _              {:group_id group-id :table_id (mt/id :venues)}]
        (store-policy! "question" card-id hourly-refreshed)
        (run-card! card-id 1)
        (is (=? {:queries_refreshed 0} (cache.refresh/refresh-due-caches!)))
        (is (empty? (refreshes card-id)))))))

(deftest refresh-due-test
  (let [refresh-due? #'cache.refresh/refresh-due?
        ;; the real time: a schedule's next run counts as a run once it has passed by the clock
        now          (t/offset-date-time)
        refreshed    (fn [cache-config at] (assoc cache-config :state {:last_refreshed_at (str at)}))
        duration     {:strategy :duration :config {:duration 1 :unit "hours"} :refresh_automatically true}
        schedule     {:strategy :schedule :config {:schedule "0 0 * * * ? *"} :refresh_automatically true}]
    (mt/with-temporary-setting-values [query-caching-early-refresh-ratio 0.1]
      (testing "Results never refreshed are due"
        (is (refresh-due? duration nil now))
        (is (refresh-due? schedule nil now)))
      (testing "A duration's results are due 2 minutes before the requests that hit them would refresh them"
        (is (not (refresh-due? (refreshed duration (t/minus now (t/minutes 51))) nil now)))
        (is (refresh-due? (refreshed duration (t/minus now (t/minutes 52))) nil now)))
      (testing "Results are due once the policy, or one of its cards, is cleared after they were refreshed"
        (let [cache-config (refreshed duration (t/minus now (t/minutes 5)))]
          (is (refresh-due? (assoc cache-config :invalidated_at (t/minus now (t/minutes 1))) nil now))
          (is (not (refresh-due? (assoc cache-config :invalidated_at (t/minus now (t/minutes 10))) nil now)))
          (is (refresh-due? cache-config (t/minus now (t/minutes 1)) now))))
      (testing "A schedule's results are due once it fires, and not before"
        (let [cache-config (refreshed schedule (t/minus now (t/minutes 30)))]
          (is (not (refresh-due? (assoc cache-config :next_run_at (t/plus now (t/minutes 1))) nil now)))
          (is (refresh-due? (assoc cache-config :next_run_at now) nil now))
          (is (refresh-due? (assoc cache-config :invalidated_at (t/minus now (t/minutes 1))) nil now)))))))
