(ns metabase.cache.task.schedule-invalidation-test
  (:require
   [clojure.test :refer :all]
   [java-time.api :as t]
   [metabase.cache.task.schedule-invalidation :as schedule-invalidation]
   [metabase.test :as mt]
   [toucan2.core :as t2]))

(defn- stored [model-id]
  (t2/select-one :model/CacheConfig :model "question" :model_id model-id))

(deftest invalidate-due-schedules-test
  (mt/with-model-cleanup [:model/CacheConfig]
    (mt/with-temporary-setting-values [report-timezone "UTC"]
      (mt/with-temp [:model/Card {due-id :id}       {}
                     :model/Card {unknown-id :id}   {}
                     :model/Card {upcoming-id :id}  {}
                     :model/Card {duration-id :id}  {}]
        (let [;; whole seconds, which every app DB stores exactly
              now          (t/truncate-to (t/offset-date-time) :seconds)
              two-days-ago (t/minus now (t/days 2))
              in-an-hour   (t/plus now (t/hours 1))
              hourly       "0 0 * * * ? *"
              insert!      (fn [model-id row]
                             (t2/insert! :model/CacheConfig (merge {:model "question" :model_id model-id} row)))]
          (insert! due-id      {:strategy :schedule :config {:schedule hourly}
                                :invalidated_at two-days-ago :next_run_at two-days-ago})
          (insert! unknown-id  {:strategy :schedule :config {:schedule hourly}})
          (insert! upcoming-id {:strategy :schedule :config {:schedule hourly}
                                :invalidated_at two-days-ago :next_run_at in-an-hour})
          (insert! duration-id {:strategy :duration :config {:duration 1 :unit "hours"}
                                :next_run_at two-days-ago})
          (schedule-invalidation/invalidate-due-schedules!)
          (testing "A schedule that ran: its latest run is recorded, with its next run"
            (let [{:keys [invalidated_at next_run_at]} (stored due-id)
                  last-hour (-> (t/instant now) (t/truncate-to :hours))]
              (is (= last-hour (t/instant invalidated_at)))
              (is (= (t/plus last-hour (t/hours 1)) (t/instant next_run_at)))))
          (testing "A schedule with no recorded next run: results cached until now are stale"
            (let [{:keys [invalidated_at next_run_at]} (stored unknown-id)]
              (is (not (t/before? (t/instant invalidated_at) (t/instant now))))
              (is (t/after? (t/instant next_run_at) (t/instant now)))))
          (testing "A schedule that hasn't run since is left alone"
            (is (= (t/instant two-days-ago) (t/instant (:invalidated_at (stored upcoming-id)))))
            (is (= (t/instant in-an-hour) (t/instant (:next_run_at (stored upcoming-id))))))
          (testing "Other strategies are left alone"
            (is (nil? (:invalidated_at (stored duration-id))))))))))

(deftest invalidate-due-schedules-keeps-later-invalidation-test
  (testing "A manual invalidation after the schedule's latest run is kept"
    (mt/with-model-cleanup [:model/CacheConfig]
      (mt/with-temporary-setting-values [report-timezone "UTC"]
        (mt/with-temp [:model/Card {card-id :id} {}]
          (let [now          (t/truncate-to (t/offset-date-time) :seconds)
                just-now     (t/minus now (t/seconds 1))
                yesterday    (t/minus now (t/days 1))]
            (t2/insert! :model/CacheConfig {:model "question" :model_id card-id :strategy :schedule
                                            ;; once a year: the latest run is long before `just-now`
                                            :config {:schedule "0 0 0 1 1 ? *"}
                                            :invalidated_at just-now :next_run_at yesterday})
            (schedule-invalidation/invalidate-due-schedules!)
            (is (= (t/instant just-now) (t/instant (:invalidated_at (stored card-id)))))))))))
