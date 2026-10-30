(ns metabase.cache.task.schedule-invalidation
  "Records each time the cron schedule of a `:schedule` cache strategy fires. Results cached before the latest run are
  stale (see [[metabase.cache.models.cache-config/card-strategy]]).

  Query time doesn't depend on this task to notice a run as soon as it's due: a `next_run_at` in the past counts as a
  run on its own. The task moves `next_run_at` on to the following run, so that the run after it is noticed too."
  (:require
   [clojurewerkz.quartzite.jobs :as jobs]
   [clojurewerkz.quartzite.schedule.cron :as cron]
   [clojurewerkz.quartzite.triggers :as triggers]
   [java-time.api :as t]
   [metabase.cache.db :as cache.db]
   [metabase.cache.schedule :as cache.schedule]
   [metabase.task.core :as task]
   [metabase.util.log :as log]))

(set! *warn-on-reflection* true)

(defn- record-run!
  "Record the latest run at or before `now` of the schedule of `cache-config`, whose next run is due (or unknown), and
  when the schedule runs next."
  [now {:keys [id config invalidated_at next_run_at]}]
  (let [schedule       (:schedule config)
        invalidated-at (if next_run_at
                         (cache.schedule/latest invalidated_at
                                                (cache.schedule/last-run-at-or-before schedule next_run_at now))
                         ;; No next run is recorded: the config was stored by a version that didn't record one, or
                         ;; its schedule never fires again. There's no run to go on, so results cached before now are
                         ;; stale unless the config was invalidated already.
                         (or invalidated_at now))]
    (cache.db/record-cache-config-schedule-run! id
                                                invalidated-at
                                                (cache.schedule/next-run-after schedule now))))

(defn invalidate-due-schedules!
  "Record the runs of every `:schedule` cache strategy whose schedule fired since it was last recorded."
  []
  (let [now (t/offset-date-time)]
    (doseq [cache-config (cache.db/due-scheduled-cache-configs now)]
      (try
        (record-run! now cache-config)
        (catch Exception e
          (log/errorf e "Error recording the run of the cache invalidation schedule of %s %s"
                      (:model cache-config) (:model_id cache-config)))))))

(task/defjob InvalidateScheduledCaches
  "Records the runs of the cron schedules of `:schedule` cache strategies."
  {:saved-class "metabase.cache.task.schedule_invalidation.InvalidateScheduledCaches"
   :concurrent? false}
  [_]
  (invalidate-due-schedules!))

(def ^:private job-key "metabase.cache.task.schedule-invalidation.job")
(def ^:private trigger-key "metabase.cache.task.schedule-invalidation.trigger")

(defmethod task/init! ::InvalidateScheduledCaches [_]
  (let [job     (jobs/build
                 (jobs/of-type InvalidateScheduledCaches)
                 (jobs/with-identity (jobs/key job-key)))
        trigger (triggers/build
                 (triggers/with-identity (triggers/key trigger-key))
                 (triggers/start-now)
                 (triggers/with-schedule
                  (cron/schedule
                   ;; every minute: the schedule picker's finest schedule is hourly, at a given minute
                   (cron/cron-schedule "0 * * * * ? *")
                   (cron/with-misfire-handling-instruction-do-nothing))))]
    (task/schedule-task! job trigger)))
