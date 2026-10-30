(ns metabase.remote-sync.tasks
  "Exports and imports as tasks: one at a time across every instance sharing the app DB, recorded in
  `remote_sync_task` with their progress and outcome, and in task history.

  While a task runs, a separate thread stamps its heartbeat and writes its progress, outside the transaction an import
  runs in, so the status stays readable. A task whose heartbeat stops (its instance died) counts as timed out and
  no longer blocks the next one."
  (:require
   [java-time.api :as t]
   [metabase.app-db.cluster-lock :as cluster-lock]
   [metabase.remote-sync.db :as remote-sync.db]
   [metabase.remote-sync.git :as git]
   [metabase.remote-sync.settings :as settings]
   [metabase.remote-sync.sync :as sync]
   [metabase.task-history.core :as task-history]
   [metabase.util.i18n :refer [tru]]
   [metabase.util.log :as log])
  (:import
   (java.util.concurrent Executors ScheduledExecutorService ThreadFactory TimeUnit)))

(set! *warn-on-reflection* true)

(def ^:private stale-after-seconds
  "How long a running task may go without a heartbeat before it counts as timed out."
  120)

(def ^:private heartbeat-seconds 10)

(def ^:private kept-task-count
  "How many ended tasks to keep; older ones are deleted when a new one starts."
  100)

(def ^:private conflict-kinds #{"remote-changed" "local-changes"})

(defn- last-sign-of-life [{:keys [last_heartbeat_at last_progress_report_at started_at]}]
  (->> [last_heartbeat_at last_progress_report_at started_at]
       (filter some?)
       (map t/offset-date-time)
       (sort t/before?)
       last))

(defn- stale? [task now]
  (when-let [seen (last-sign-of-life task)]
    (t/before? seen (t/minus now (t/seconds stale-after-seconds)))))

(defn task-status
  "The status of `task`: `running`, `successful`, `conflict` (it stopped rather than overwrite changes), `errored`,
  `timed-out` or `cancelled`."
  [{:keys [ended_at cancelled error_message outcome] :as task}]
  (cond
    cancelled                                  "cancelled"
    (and (nil? ended_at)
         (stale? task (t/offset-date-time)))   "timed-out"
    (nil? ended_at)                            "running"
    (contains? conflict-kinds (:kind outcome)) "conflict"
    (some? error_message)                      "errored"
    :else                                      "successful"))

(defn- expire-stale-tasks! [now]
  (doseq [task (remote-sync.db/unfinished-tasks)
          :when (stale? task now)]
    (log/warnf "Git sync: task %d stopped responding; marking it as timed out" (:id task))
    (remote-sync.db/update-task! (:id task) {:ended_at      now
                                             :error_message (tru "The task stopped responding, probably because Metabase restarted while it ran.")})))

(defn- prune-tasks! []
  (remote-sync.db/delete-tasks! (vec (drop kept-task-count (remote-sync.db/finished-task-ids)))))

(defn claim-task!
  "Start a task of `task-type` (`:import` or `:export`) for the user with `user-id` (nil for a scheduled one) and return
  it. Throws a 409 when another task is running."
  [task-type user-id]
  (cluster-lock/with-cluster-lock ::claim
    (let [now (t/offset-date-time)]
      (expire-stale-tasks! now)
      (when (seq (remote-sync.db/unfinished-tasks))
        (throw (ex-info (tru "Another Git sync export or import is running. Try again when it has finished.")
                        {:status-code 409})))
      (prune-tasks!)
      (remote-sync.db/insert-task! {:sync_task_type          task-type
                                    :initiated_by            user-id
                                    :started_at              now
                                    :last_progress_report_at now
                                    :last_heartbeat_at       now
                                    :progress                0.0}))))

(defn- daemon-thread-factory ^ThreadFactory [thread-name]
  (reify ThreadFactory
    (newThread [_ runnable]
      (doto (Thread. runnable ^String thread-name)
        (.setDaemon true)))))

(defn- start-status-writer!
  "Start writing the heartbeat of the task with `task-id` from a thread of its own. Returns `{:progress! f, :stop! f}`."
  [task-id]
  (let [^ScheduledExecutorService executor (Executors/newSingleThreadScheduledExecutor
                                            (daemon-thread-factory (str "git-sync-task-" task-id)))
        write!   (fn [changes]
                   (try
                     (remote-sync.db/update-task! task-id changes)
                     (catch Throwable e
                       (log/warnf e "Git sync: could not update the status of task %d" task-id))))
        reported (atom {:progress 0.0, :at 0})]
    (.scheduleAtFixedRate executor
                          ^Runnable (fn [] (write! {:last_heartbeat_at (t/offset-date-time)}))
                          (long heartbeat-seconds) (long heartbeat-seconds) TimeUnit/SECONDS)
    {:progress! (fn [progress]
                  (let [now-ms                 (System/currentTimeMillis)
                        {previous :progress at :at} @reported]
                    (when (or (>= (- progress previous) 0.05) (>= (- now-ms at) 1000))
                      (reset! reported {:progress progress, :at now-ms})
                      (.execute executor ^Runnable (fn [] (write! {:progress                (double progress)
                                                                   :last_progress_report_at (t/offset-date-time)}))))))
     :stop!     (fn []
                  (.shutdown executor)
                  (.awaitTermination executor 10 TimeUnit/SECONDS))}))

(defn- ended-changes
  "The columns to write when a task ends with `result` from its function, or with the exception `e`."
  [result ^Throwable e]
  (let [now                     (t/offset-date-time)
        {::sync/keys [conflict]
         :keys       [conflicts]} (ex-data e)]
    (cond
      conflict {:ended_at      now
                :error_message (ex-message e)
                :conflicts     (vec conflicts)
                :outcome       {:kind (name conflict)}}
      e        {:ended_at      now
                :error_message (or (ex-message e) (.getName (class e)))}
      :else    {:ended_at now
                :progress 1.0
                :version  (:commit result)
                :outcome  (:outcome result)})))

(defn run-task!
  "Run `f` as `task` (from [[claim-task!]]) and record how it ends. `f` takes a function to report progress with and
  returns `{:commit sha, :outcome map}`. `history-name` names the task in task history. Returns the ended task."
  [task history-name f]
  (let [task-id (:id task)
        {:keys [progress! stop!]} (start-status-writer! task-id)
        [result error] (try
                         [(task-history/with-task-history {:task         history-name
                                                           :task_details {:task-id task-id}}
                            (f progress!))
                          nil]
                         (catch Throwable e
                           (log/warnf e "Git sync: %s failed" history-name)
                           [nil e])
                         (finally
                           (stop!)))]
    (remote-sync.db/update-task! task-id (ended-changes result error))
    (remote-sync.db/task task-id)))

(defn- run-in-background! [task history-name f]
  (doto (Thread. ^Runnable (fn [] (run-task! task history-name f))
                 (str "git-sync-" history-name "-" (:id task)))
    (.setDaemon true)
    (.start))
  task)

(defn start-export!
  "Start exporting the synced content in the background, for the user `user` (`:id`, `:first_name`, `:last_name`,
  `:email`). `opts` are those of [[metabase.remote-sync.sync/export!]]. Returns the task."
  [user opts]
  (let [task (claim-task! :export (:id user))]
    (run-in-background! task "remote-sync-export"
                        (fn [progress!] (sync/export! (assoc opts :user user :progress! progress!))))))

(defn start-import!
  "Start importing the content of the branch in the background, for the user with `user-id`. `opts` are those of
  [[metabase.remote-sync.sync/import!]]. Returns the task."
  [user-id opts]
  (let [task (claim-task! :import user-id)]
    (run-in-background! task "remote-sync-import"
                        (fn [progress!] (sync/import! (assoc opts :progress! progress!))))))

;;; ------------------------------------------------- Auto-import --------------------------------------------------

(defn- auto-import-due? [now]
  (let [last-check (settings/remote-sync-last-auto-import-check)
        interval   (-> (or (settings/remote-sync-auto-import-interval) 15)
                       (max settings/min-auto-import-interval-minutes)
                       (min settings/max-auto-import-interval-minutes))]
    (and (settings/remote-sync-enabled)
         (settings/remote-sync-auto-import)
         (or (nil? last-check)
             ;; a minute's slack, since the job that checks runs every minute
             (not (t/before? now (t/plus (t/offset-date-time last-check) (t/minutes interval) (t/seconds -30))))))))

(defn- record-failed-check! [^Throwable e]
  (let [now (t/offset-date-time)]
    (remote-sync.db/insert-task! {:sync_task_type          :import
                                  :started_at              now
                                  :ended_at                now
                                  :last_progress_report_at now
                                  :error_message           (or (ex-message e) (.getName (class e)))})))

(defn auto-import!
  "When scheduled imports are on and due, import the branch if it has a commit this instance hasn't synced. A
  read-only instance discards local changes to synced content; a read-write one stops rather than overwrite them.
  Returns the import task, or nil when nothing ran."
  []
  (let [now (t/offset-date-time)]
    (when (auto-import-due? now)
      (settings/remote-sync-last-auto-import-check! now)
      (when-let [tip (try
                       (git/remote-branch-commit (settings/git-config))
                       (catch Throwable e
                         (log/warnf "Git sync: scheduled import could not reach the repository: %s" (ex-message e))
                         (record-failed-check! e)
                         nil))]
        (when (not= tip (settings/remote-sync-last-synced-commit))
          (when-let [task (try
                            (claim-task! :import nil)
                            (catch clojure.lang.ExceptionInfo e
                              (when-not (= 409 (:status-code (ex-data e)))
                                (throw e))
                              (log/infof "Git sync: skipping the scheduled import: %s" (ex-message e))
                              nil))]
            (run-task! task "remote-sync-auto-import"
                       (fn [progress!]
                         (sync/import! {:force?    (settings/read-only?)
                                        :progress! progress!})))))))))
