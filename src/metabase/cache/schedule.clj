(ns metabase.cache.schedule
  "When the cron schedule of a `:schedule` cache strategy fires.

  A schedule is read in the report timezone (the system timezone when none is set), which is the timezone the schedule
  picker shows it in."
  (:require
   [java-time.api :as t]
   [metabase.settings.core :as setting])
  (:import
   (java.time OffsetDateTime ZoneOffset)
   (java.util Date TimeZone)
   (org.quartz CronExpression)))

(set! *warn-on-reflection* true)

(def ^:private max-catch-up-runs
  "How many runs [[last-run-at-or-before]] steps through at most. A schedule that fired more often than this while
  nothing was looking (an instance that was down for a long time) is treated as having fired last at the step it
  stopped at, which only makes a few more cached results stale than strictly necessary."
  10000)

(defn- cron-expression
  ^CronExpression [^String schedule]
  (doto (CronExpression. schedule)
    (.setTimeZone (TimeZone/getTimeZone ^String (setting/get :report-timezone-long)))))

(defn- ->date
  ^Date [instant]
  (Date/from (t/instant instant)))

(defn- ->offset-date-time
  ^OffsetDateTime [^Date date]
  (OffsetDateTime/ofInstant (.toInstant date) ZoneOffset/UTC))

(defn next-run-after
  "The first time after `instant` at which the cron `schedule` fires, or nil if it never fires again."
  ^OffsetDateTime [schedule instant]
  (some-> (.getNextValidTimeAfter (cron-expression schedule) (->date instant))
          ->offset-date-time))

(defn last-run-at-or-before
  "The last time at or before `now` at which the cron `schedule` fires, given `run-at`, a time at or before `now` at
  which it fired."
  ^OffsetDateTime [schedule run-at now]
  (let [expression (cron-expression schedule)
        now        (->date now)]
    (loop [last-run (->date run-at)
           steps    0]
      (let [next-run (.getNextValidTimeAfter expression last-run)]
        (if (or (nil? next-run)
                (.after next-run now)
                (>= steps max-catch-up-runs))
          (->offset-date-time last-run)
          (recur next-run (inc steps)))))))

(defn latest
  "The latest of the `timestamps` that aren't nil, or nil when they all are."
  [& timestamps]
  (reduce (fn [latest-so-far timestamp]
            (if (or (nil? latest-so-far)
                    (and timestamp (t/before? (t/instant latest-so-far) (t/instant timestamp))))
              timestamp
              latest-so-far))
          nil
          timestamps))

(defn due?
  "Whether `run-at`, the next run of a schedule, is at or before `now`."
  [run-at now]
  (boolean (and run-at (not (t/after? (t/instant run-at) (t/instant now))))))
