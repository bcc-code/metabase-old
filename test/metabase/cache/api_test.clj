(ns metabase.cache.api-test
  (:require
   [clojure.test :refer :all]
   [java-time.api :as t]
   [metabase.permissions.core :as perms]
   [metabase.premium-features.core :as premium-features]
   [metabase.test :as mt]
   [toucan2.core :as t2])
  (:import
   (java.time OffsetDateTime ZoneOffset)))

(set! *warn-on-reflection* true)

(defn- stored-config [model model-id]
  (t2/select-one :model/CacheConfig :model model :model_id model-id))

(defn- utc ^OffsetDateTime [timestamp]
  (.atOffset (t/instant timestamp) ZoneOffset/UTC))

(deftest cache-config-root-settings-test
  (mt/with-model-cleanup [:model/CacheConfig]
    (mt/with-premium-features #{}
      (testing "Can operate on root settings"
        (is (mt/user-http-request :crowberto :put 200 "cache/"
                                  {:model    "root"
                                   :model_id 0
                                   :strategy {:type "nocache"}}))
        (is (=? {:data [{:model "root" :model_id 0}]}
                (mt/user-http-request :crowberto :get 200 "cache/"
                                      :model "root")))
        (is (nil? (mt/user-http-request :crowberto :delete 204 "cache/"
                                        {:model "root" :model_id 0})))))))

(deftest granular-cache-configs-without-token-test
  (testing "This edition provides granular caching without a premium token: every model and every strategy"
    (mt/with-model-cleanup [:model/CacheConfig]
      (mt/with-premium-features #{}
        (mt/with-temp [:model/Dashboard {dashboard-id :id} {}
                       :model/Card      {card-id :id}      {}]
          (doseq [[model model-id strategy] [["root"      0            {:type "ttl" :multiplier 10 :min_duration_ms 1000}]
                                             ["database"  (mt/id)      {:type "duration" :duration 2 :unit "hours"}]
                                             ["dashboard" dashboard-id {:type "schedule" :schedule "0 0 6 * * ? *"}]
                                             ["question"  card-id      {:type "nocache"}]]]
            (testing model
              (is (=? {:id pos-int?}
                      (mt/user-http-request :crowberto :put 200 "cache/"
                                            {:model model :model_id model-id :strategy strategy})))
              (is (=? {:data [{:model model :model_id model-id :strategy strategy}]}
                      (apply mt/user-http-request :crowberto :get 200 "cache/"
                             :model model (when (pos? model-id) [:id model-id]))))
              (when-not (= model "root")
                (is (nil? (mt/user-http-request :crowberto :delete 204 "cache/"
                                                {:model model :model_id model-id})))
                (is (nil? (stored-config model model-id)))))))))))

(deftest granular-cache-configs-when-unavailable-test
  (testing "Without granular cache controls only the root configuration, with `nocache` or `ttl`, can be stored"
    (mt/with-model-cleanup [:model/CacheConfig]
      (mt/with-dynamic-fn-redefs [premium-features/enable-cache-granular-controls? (constantly false)]
        (mt/assert-has-premium-feature-error "Granular Caching"
                                             (mt/user-http-request :crowberto :put 402 "cache/"
                                                                   {:model    "database"
                                                                    :model_id (mt/id)
                                                                    :strategy {:type "nocache"}}))
        (is (= {:strategy "cache strategy :type must be one of :nocache, :ttl"}
               (:errors (mt/user-http-request :crowberto :put 400 "cache/"
                                              {:model    "root"
                                               :model_id 0
                                               :strategy {:type     "schedule"
                                                          :schedule "0 0 6 * * ? *"}}))))))))

(deftest cache-strategy-validation-test
  (mt/with-model-cleanup [:model/CacheConfig]
    (doseq [[description strategy] [["an unknown strategy"      {:type "forever"}]
                                    ["a duration of zero"       {:type "duration" :duration 0 :unit "hours"}]
                                    ["a fractional duration"    {:type "duration" :duration 1.5 :unit "hours"}]
                                    ["a duration without unit"  {:type "duration" :duration 1}]
                                    ["an unknown duration unit" {:type "duration" :duration 1 :unit "weeks"}]
                                    ["an invalid cron schedule" {:type "schedule" :schedule "every day"}]
                                    ["a schedule without cron"  {:type "schedule"}]
                                    ["a negative multiplier"    {:type "ttl" :multiplier -1 :min_duration_ms 0}]]]
      (testing (str "Rejects " description)
        (mt/user-http-request :crowberto :put 400 "cache/"
                              {:model "database" :model_id (mt/id) :strategy strategy})
        (is (nil? (stored-config "database" (mt/id))))))))

(deftest cache-config-targets-must-exist-test
  (mt/with-model-cleanup [:model/CacheConfig]
    (doseq [model ["database" "dashboard" "question"]]
      (testing model
        (mt/user-http-request :crowberto :put 404 "cache/"
                              {:model model :model_id Integer/MAX_VALUE :strategy {:type "nocache"}})))
    (testing "The root configuration has id 0"
      (mt/user-http-request :crowberto :put 404 "cache/"
                            {:model "root" :model_id 1 :strategy {:type "nocache"}}))))

(deftest schedule-bookkeeping-test
  (mt/with-model-cleanup [:model/CacheConfig]
    (mt/with-temporary-setting-values [report-timezone "UTC"]
      (let [store! (fn [strategy]
                     (mt/user-http-request :crowberto :put 200 "cache/"
                                           {:model "database" :model_id (mt/id) :strategy strategy}))
            before (t/offset-date-time)]
        (testing "Storing a schedule records when it runs next, and makes results cached until now stale"
          (store! {:type "schedule" :schedule "0 0 6 * * ? *"})
          (let [{:keys [invalidated_at next_run_at]} (stored-config "database" (mt/id))]
            (is (not (t/before? (t/instant invalidated_at) (t/instant before))))
            (is (t/after? (t/instant next_run_at) (t/instant)))
            (is (= 6 (.getHour (utc next_run_at))))
            (testing "Storing the same schedule again keeps both"
              (store! {:type "schedule" :schedule "0 0 6 * * ? *"})
              (is (=? {:invalidated_at invalidated_at :next_run_at next_run_at}
                      (stored-config "database" (mt/id)))))
            (testing "A new schedule runs at its own times"
              (store! {:type "schedule" :schedule "0 30 7 * * ? *"})
              (is (= 30 (.getMinute (utc (:next_run_at (stored-config "database" (mt/id))))))))))
        (testing "Other strategies don't run on a schedule"
          (store! {:type "duration" :duration 1 :unit "hours"})
          (is (nil? (:next_run_at (stored-config "database" (mt/id))))))))))

(deftest refresh-automatically-needs-preemptive-caching-test
  (testing "Automatic refreshing isn't stored when nothing refreshes cached results ahead of time"
    (mt/with-model-cleanup [:model/CacheConfig]
      (mt/with-premium-features #{}
        (mt/user-http-request :crowberto :put 200 "cache/"
                              {:model    "database"
                               :model_id (mt/id)
                               :strategy {:type "duration" :duration 1 :unit "hours" :refresh_automatically true}})
        (is (=? {:data [{:strategy {:type "duration" :refresh_automatically false}}]}
                (mt/user-http-request :crowberto :get 200 "cache/" :model "database" :id (mt/id))))))))

(deftest list-dashboard-and-question-configs-test
  (testing "Listing dashboard and question configs includes their names and collections, for the admin table"
    (mt/with-model-cleanup [:model/CacheConfig]
      (mt/with-temp [:model/Collection {coll-id :id}      {:name "Cached collection"}
                     :model/Dashboard  {dashboard-id :id} {:name "Cached dashboard" :collection_id coll-id}
                     :model/Card       {card-id :id}      {:name "Cached question" :collection_id coll-id}
                     :model/Card       {other-id :id}     {:name "Question elsewhere"}]
        (doseq [[model model-id] [["dashboard" dashboard-id] ["question" card-id] ["question" other-id]]]
          (mt/user-http-request :crowberto :put 200 "cache/"
                                {:model model :model_id model-id :strategy {:type "duration" :duration 3 :unit "days"}}))
        (let [response (mt/user-http-request :crowberto :get 200 "cache/"
                                             :model "dashboard" :model "question" :collection coll-id)]
          (is (=? [{:model      "dashboard"
                    :model_id   dashboard-id
                    :name       "Cached dashboard"
                    :collection {:id coll-id :name "Cached collection"}
                    :strategy   {:type "duration" :duration 3 :unit "days"}}
                   {:model      "question"
                    :model_id   card-id
                    :name       "Cached question"
                    :collection {:id coll-id :name "Cached collection"}}]
                  (sort-by :name (:data response)))))
        (testing "paged and sorted"
          (is (=? {:data   [{:name "Cached question"}]
                   :total  2
                   :limit  1
                   :offset 1}
                  (mt/user-http-request :crowberto :get 200 "cache/"
                                        :model "dashboard" :model "question" :collection coll-id
                                        :limit 1 :offset 1 :sort_column "name" :sort_direction "asc"))))))))

(deftest cache-config-permissions-test
  (mt/with-model-cleanup [:model/CacheConfig]
    (mt/with-temp [:model/Collection {coll-id :id :as coll} {}
                   :model/Card       {card-id :id}          {:collection_id coll-id}
                   :model/Dashboard  {dashboard-id :id}     {:collection_id coll-id}]
      (mt/with-non-admin-groups-no-collection-perms coll-id
        (let [put! (fn [status model model-id]
                     (mt/user-http-request :rasta :put status "cache/"
                                           {:model model :model_id model-id :strategy {:type "nocache"}}))]
          (testing "Non-admins without write access to the collection can't set a policy"
            (put! 403 "question" card-id)
            (put! 403 "dashboard" dashboard-id))
          (testing "Non-admins who can write the collection can set the policies of its questions and dashboards"
            (perms/grant-collection-readwrite-permissions! (perms/all-users-group) coll)
            (put! 200 "question" card-id)
            (put! 200 "dashboard" dashboard-id)
            (is (=? {:data [{:model "question" :model_id card-id}]}
                    (mt/user-http-request :rasta :get 200 "cache/" :model "question" :id card-id))))
          (testing "Only admins can set database and root policies, or list the policies of every item"
            (put! 403 "database" (mt/id))
            (put! 403 "root" 0)
            (mt/user-http-request :rasta :get 403 "cache/" :model "dashboard" :model "question")))))))

(deftest invalidate-test
  (mt/with-model-cleanup [:model/CacheConfig]
    (mt/with-temp [:model/Card          {card-id :id}      {}
                   :model/Card          {other-id :id}     {}
                   :model/Dashboard     {dashboard-id :id} {}
                   :model/DashboardCard _                  {:dashboard_id dashboard-id :card_id card-id}
                   ;; a text card has no Card
                   :model/DashboardCard _                  {:dashboard_id dashboard-id :card_id nil}]
      (testing "Clearing a question's cache invalidates its results"
        (is (=? {:count 1}
                (mt/user-http-request :crowberto :post 200 "cache/invalidate" :include "overrides" :question card-id)))
        (is (some? (t2/select-one-fn :cache_invalidated_at :model/Card card-id)))
        (is (nil? (t2/select-one-fn :cache_invalidated_at :model/Card other-id))))
      (testing "Clearing a dashboard's cache invalidates the results of its questions"
        (t2/update! :model/Card card-id {:cache_invalidated_at nil})
        (is (=? {:count 1}
                (mt/user-http-request :crowberto :post 200 "cache/invalidate" :include "overrides" :dashboard dashboard-id)))
        (is (some? (t2/select-one-fn :cache_invalidated_at :model/Card card-id))))
      (testing "Invalidating a config marks it invalidated"
        (mt/user-http-request :crowberto :put 200 "cache/"
                              {:model "dashboard" :model_id dashboard-id :strategy {:type "duration" :duration 1 :unit "hours"}})
        (is (=? {:count 1}
                (mt/user-http-request :crowberto :post 200 "cache/invalidate" :dashboard dashboard-id)))
        (is (some? (:invalidated_at (stored-config "dashboard" dashboard-id)))))
      (testing "At least one target is required"
        (mt/user-http-request :crowberto :post 400 "cache/invalidate" :include "overrides")))))

(deftest invalidate-root-test
  (mt/with-model-cleanup [:model/CacheConfig]
    (testing "Only admins can clear every cached result"
      (mt/user-http-request :rasta :post 403 "cache/invalidate" :include "overrides" :root 0))
    (testing "The root configuration has id 0"
      (mt/user-http-request :crowberto :post 404 "cache/invalidate" :include "overrides" :root 1))
    (testing "Clearing the root cache deletes every cached result"
      (mt/with-temp [:model/QueryCache _ {:query_hash (byte-array (range 32))
                                          :results    (byte-array [0])
                                          :updated_at (t/offset-date-time)}]
        (is (=? {:count pos-int?}
                (mt/user-http-request :crowberto :post 200 "cache/invalidate" :include "overrides" :root 0)))
        (is (zero? (t2/count :model/QueryCache)))))
    (testing "Invalidating the root configuration marks it invalidated"
      (mt/user-http-request :crowberto :put 200 "cache/"
                            {:model "root" :model_id 0 :strategy {:type "duration" :duration 1 :unit "hours"}})
      (is (=? {:count 1}
              (mt/user-http-request :crowberto :post 200 "cache/invalidate" :root 0)))
      (is (some? (:invalidated_at (stored-config "root" 0)))))))
