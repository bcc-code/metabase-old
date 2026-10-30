(ns metabase.cache.refresh.task
  "Refreshes cached results automatically every minute; see [[metabase.cache.refresh.core]]."
  (:require
   [clojurewerkz.quartzite.jobs :as jobs]
   [clojurewerkz.quartzite.schedule.cron :as cron]
   [clojurewerkz.quartzite.triggers :as triggers]
   [metabase.cache.refresh.core :as cache.refresh]
   [metabase.task.core :as task]))

(set! *warn-on-reflection* true)

(task/defjob RefreshCaches
  "Refreshes the cached results of questions and dashboards whose caching policy refreshes them automatically."
  {:saved-class "metabase.cache.refresh.task.RefreshCaches"
   :concurrent? false}
  [_]
  (cache.refresh/refresh-due-caches!))

(def ^:private job-key "metabase.cache.refresh.task.job")
(def ^:private trigger-key "metabase.cache.refresh.task.trigger")

(defmethod task/init! ::RefreshCaches [_]
  (let [job     (jobs/build
                 (jobs/of-type RefreshCaches)
                 (jobs/with-identity (jobs/key job-key)))
        trigger (triggers/build
                 (triggers/with-identity (triggers/key trigger-key))
                 (triggers/start-now)
                 (triggers/with-schedule
                  (cron/schedule
                   ;; every minute, at second 30: the schedule invalidation task runs at second 0
                   (cron/cron-schedule "30 * * * * ? *")
                   (cron/with-misfire-handling-instruction-do-nothing))))]
    (task/schedule-task! job trigger)))
