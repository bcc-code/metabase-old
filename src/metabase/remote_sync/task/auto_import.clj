(ns metabase.remote-sync.task.auto-import
  "A Quartz job that imports new commits of the Git sync branch on the schedule set by the
  `remote-sync-auto-import` and `remote-sync-auto-import-interval` settings. It runs every minute and imports only
  when the interval has passed, so changing the interval takes effect without rescheduling."
  (:require
   [clojurewerkz.quartzite.jobs :as jobs]
   [clojurewerkz.quartzite.schedule.cron :as cron]
   [clojurewerkz.quartzite.triggers :as triggers]
   [metabase.remote-sync.tasks :as remote-sync.tasks]
   [metabase.task.core :as task]
   [metabase.util.log :as log]))

(set! *warn-on-reflection* true)

(task/defjob GitSyncAutoImport
  "Import new commits of the Git sync branch when scheduled imports are on and due."
  {:saved-class "metabase.remote_sync.task.auto_import.GitSyncAutoImport"
   :concurrent? false}
  [_]
  (try
    (remote-sync.tasks/auto-import!)
    (catch Throwable e
      (log/error e "Git sync: scheduled import failed"))))

(def ^:private job-key     (jobs/key "metabase.task.remote-sync.auto-import.job"))
(def ^:private trigger-key (triggers/key "metabase.task.remote-sync.auto-import.trigger"))

(defmethod task/init! ::GitSyncAutoImport [_]
  (let [job     (jobs/build
                 (jobs/of-type GitSyncAutoImport)
                 (jobs/with-identity job-key))
        trigger (triggers/build
                 (triggers/with-identity trigger-key)
                 (triggers/start-now)
                 (triggers/with-schedule
                  ;; every minute; the job itself checks whether an import is due
                  (cron/cron-schedule "0 * * * * ? *")))]
    (task/schedule-task! job trigger)))
