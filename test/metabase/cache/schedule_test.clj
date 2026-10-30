(ns metabase.cache.schedule-test
  (:require
   [clojure.test :refer :all]
   [java-time.api :as t]
   [metabase.cache.schedule :as cache.schedule]
   [metabase.test :as mt]))

(defn- instant [s]
  (t/instant s))

(deftest next-run-after-test
  (mt/with-temporary-setting-values [report-timezone "UTC"]
    (is (= (instant "2026-03-02T06:00:00Z")
           (t/instant (cache.schedule/next-run-after "0 0 6 * * ? *" (t/offset-date-time "2026-03-01T06:00:00Z")))))
    (is (= (instant "2026-03-01T06:00:00Z")
           (t/instant (cache.schedule/next-run-after "0 0 6 * * ? *" (t/offset-date-time "2026-03-01T05:59:00Z")))))
    (testing "A schedule that never runs again"
      (is (nil? (cache.schedule/next-run-after "0 0 6 1 1 ? 2020" (t/offset-date-time "2026-03-01T00:00:00Z"))))))
  (testing "Schedules run in the report timezone"
    (mt/with-temporary-setting-values [report-timezone "Europe/Oslo"]
      (is (= (instant "2026-03-01T05:00:00Z")
             (t/instant (cache.schedule/next-run-after "0 0 6 * * ? *" (t/offset-date-time "2026-03-01T00:00:00Z"))))))))

(deftest last-run-at-or-before-test
  (mt/with-temporary-setting-values [report-timezone "UTC"]
    (testing "The run itself, when the schedule hasn't run again since"
      (is (= (instant "2026-03-01T06:00:00Z")
             (t/instant (cache.schedule/last-run-at-or-before "0 0 6 * * ? *"
                                                              (t/offset-date-time "2026-03-01T06:00:00Z")
                                                              (t/offset-date-time "2026-03-01T12:00:00Z"))))))
    (testing "The latest run, when the schedule ran several times since"
      (is (= (instant "2026-03-04T06:00:00Z")
             (t/instant (cache.schedule/last-run-at-or-before "0 0 6 * * ? *"
                                                              (t/offset-date-time "2026-03-01T06:00:00Z")
                                                              (t/offset-date-time "2026-03-04T12:00:00Z"))))))))

(deftest latest-test
  (let [earlier (t/offset-date-time "2026-03-01T06:00:00Z")
        later   (t/offset-date-time "2026-03-02T06:00:00Z")]
    (is (nil? (cache.schedule/latest)))
    (is (nil? (cache.schedule/latest nil nil)))
    (is (= later (cache.schedule/latest earlier nil later)))
    (is (= later (cache.schedule/latest nil later earlier)))))

(deftest due?-test
  (let [now (t/offset-date-time "2026-03-01T06:00:00Z")]
    (is (false? (cache.schedule/due? nil now)))
    (is (true? (cache.schedule/due? now now)))
    (is (true? (cache.schedule/due? (t/minus now (t/minutes 1)) now)))
    (is (false? (cache.schedule/due? (t/plus now (t/minutes 1)) now)))))
