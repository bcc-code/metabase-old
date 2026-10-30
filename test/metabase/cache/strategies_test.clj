(ns metabase.cache.strategies-test
  (:require
   [clojure.test :refer :all]
   [java-time.api :as t]
   [metabase.cache.strategies :as cache.strategies]
   [metabase.premium-features.core :as premium-features]
   [metabase.test :as mt]
   [toucan2.core :as t2]))

(defn- strategy-type [card dashboard-id]
  (:type (cache.strategies/effective-strategy (t2/select-one :model/Card (:id card)) dashboard-id)))

(deftest most-specific-config-wins-test
  ;; rolled back, so that removing any root config this test doesn't own leaves no trace
  (t2/with-transaction [_conn nil {:rollback-only true}]
    (mt/with-temp [:model/Database  {db-id :id}        {}
                   :model/Card      card               {:database_id db-id}
                   :model/Dashboard {dashboard-id :id} {}]
      (testing "Nothing configured: results aren't cached"
        (t2/delete! :model/CacheConfig :model "root")
        (is (nil? (cache.strategies/effective-strategy card dashboard-id))))
      (testing "The root config applies when nothing more specific is configured"
        (t2/insert! :model/CacheConfig {:model "root" :model_id 0 :strategy :ttl
                                        :config {:multiplier 10 :min_duration_ms 1000}})
        (is (= :ttl (strategy-type card dashboard-id))))
      (testing "The database config beats the root config"
        (t2/insert! :model/CacheConfig {:model "database" :model_id db-id :strategy :duration
                                        :config {:duration 1 :unit "hours"}})
        (is (= :duration (strategy-type card dashboard-id))))
      (testing "The dashboard config beats the database config, but only when the card runs on the dashboard"
        (t2/insert! :model/CacheConfig {:model "dashboard" :model_id dashboard-id :strategy :schedule
                                        :config {:schedule "0 0 6 * * ? *"}})
        (is (= :schedule (strategy-type card dashboard-id)))
        (is (= :duration (strategy-type card nil))))
      (testing "The question config beats them all"
        (t2/insert! :model/CacheConfig {:model "question" :model_id (:id card) :strategy :nocache :config {}})
        (is (= :nocache (strategy-type card dashboard-id)))
        (is (= :nocache (strategy-type card nil))))
      (testing "Configs of other entities don't count"
        (mt/with-temp [:model/Card other-card {:database_id db-id}]
          (is (= :duration (strategy-type other-card nil)))))
      (testing "Without granular cache controls only a root :ttl config counts"
        (mt/with-dynamic-fn-redefs [premium-features/enable-cache-granular-controls? (constantly false)]
          (is (= :ttl (strategy-type card dashboard-id))))))))

(deftest strategy-shape-test
  (mt/with-model-cleanup [:model/CacheConfig]
    (mt/with-temp [:model/Card card {}]
      (t2/insert! :model/CacheConfig {:model "question" :model_id (:id card) :strategy :duration
                                      :config {:duration 30 :unit "minutes"} :refresh_automatically false})
      (is (= {:type :duration :duration 30 :unit "minutes" :refresh_automatically false}
             (cache.strategies/effective-strategy card nil))))))

(deftest invalidated-at-test
  (mt/with-model-cleanup [:model/CacheConfig]
    (mt/with-temp [:model/Card card {}]
      (let [;; whole seconds, which every app DB stores exactly
            now        (t/truncate-to (t/offset-date-time) :seconds)
            hour-ago   (t/minus now (t/hours 1))
            minute-ago (t/minus now (t/minutes 1))
            in-an-hour (t/plus now (t/hours 1))
            store!     (fn [row]
                         (t2/delete! :model/CacheConfig :model "question" :model_id (:id card))
                         (t2/insert! :model/CacheConfig (merge {:model "question" :model_id (:id card)} row)))
            invalidated-at (fn [card]
                             (some-> (:invalidated-at (cache.strategies/effective-strategy card nil)) t/instant))]
        (testing "Nothing invalidated"
          (store! {:strategy :duration :config {:duration 1 :unit "hours"}})
          (is (nil? (invalidated-at card))))
        (testing "The config was invalidated"
          (store! {:strategy :duration :config {:duration 1 :unit "hours"} :invalidated_at hour-ago})
          (is (= (t/instant hour-ago) (invalidated-at card))))
        (testing "The card was invalidated later than the config"
          (is (= (t/instant minute-ago) (invalidated-at (assoc card :cache_invalidated_at minute-ago)))))
        (testing "A schedule whose next run is still ahead"
          (store! {:strategy :schedule :config {:schedule "0 0 * * * ? *"}
                   :invalidated_at hour-ago :next_run_at in-an-hour})
          (is (= (t/instant hour-ago) (invalidated-at card))))
        (testing "A schedule that ran, before the task recorded the run"
          (store! {:strategy :schedule :config {:schedule "0 0 * * * ? *"}
                   :invalidated_at hour-ago :next_run_at minute-ago})
          (is (= (t/instant minute-ago) (invalidated-at card))))))))
