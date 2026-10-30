(ns metabase.remote-sync.tasks-test
  "Running exports and imports as tasks: one at a time, with their outcome recorded, and on a schedule."
  (:require
   [clojure.test :refer :all]
   [java-time.api :as t]
   [metabase.remote-sync.db :as remote-sync.db]
   [metabase.remote-sync.settings :as settings]
   [metabase.remote-sync.sync :as sync]
   [metabase.remote-sync.tasks :as tasks]
   [metabase.remote-sync.test-util :as remote-sync.tu]
   [metabase.test :as mt]
   [toucan2.core :as t2]))

(set! *warn-on-reflection* true)

(deftest one-task-at-a-time-test
  (mt/with-model-cleanup [:model/GitSyncTask]
    (let [task (tasks/claim-task! :export (mt/user->id :crowberto))]
      (is (=? {:sync_task_type :export, :initiated_by (mt/user->id :crowberto), :ended_at nil} task))
      (is (= "running" (tasks/task-status task)))
      (testing "a second task can't start while one runs"
        (is (thrown-with-msg? clojure.lang.ExceptionInfo #"Another Git sync export or import is running"
                              (tasks/claim-task! :import nil))))
      (testing "it can once the first has ended"
        (tasks/run-task! task "remote-sync-export" (fn [_progress!] {:commit "abc", :outcome {:kind "push-skipped"}}))
        (is (some? (tasks/claim-task! :import nil)))))))

(deftest stale-task-times-out-test
  (mt/with-model-cleanup [:model/GitSyncTask]
    (let [long-ago (t/minus (t/offset-date-time) (t/minutes 10))
          stale    (remote-sync.db/insert-task! {:sync_task_type          :import
                                                 :started_at              long-ago
                                                 :last_progress_report_at long-ago
                                                 :last_heartbeat_at       long-ago})]
      (is (= "timed-out" (tasks/task-status stale)))
      (testing "a task that stopped responding doesn't block the next one"
        (is (some? (tasks/claim-task! :export nil)))
        (is (=? {:ended_at some? :error_message #".*stopped responding.*"}
                (remote-sync.db/task (:id stale))))))))

(deftest run-task-records-the-outcome-test
  (mt/with-model-cleanup [:model/GitSyncTask]
    (testing "success"
      (let [task (tasks/claim-task! :export nil)
            done (tasks/run-task! task "remote-sync-export"
                                  (fn [progress!]
                                    (progress! 0.5)
                                    {:commit "0123abc", :outcome {:kind "pushed", :count 2, :branch "main"}}))]
        (is (=? {:ended_at some?, :progress 1.0, :version "0123abc"
                 :outcome  {:kind "pushed", :count 2, :branch "main"}}
                done))
        (is (= "successful" (tasks/task-status done)))))
    (testing "a conflict"
      (let [task (tasks/claim-task! :import nil)
            done (tasks/run-task! task "remote-sync-import"
                                  (fn [_progress!]
                                    (throw (sync/conflict "Local changes" :local-changes ["Changed card: Orders"]))))]
        (is (=? {:error_message "Local changes", :conflicts ["Changed card: Orders"], :outcome {:kind "local-changes"}}
                done))
        (is (= "conflict" (tasks/task-status done)))))
    (testing "an error"
      (let [task (tasks/claim-task! :import nil)
            done (tasks/run-task! task "remote-sync-import" (fn [_progress!] (throw (ex-info "Boom" {}))))]
        (is (=? {:error_message "Boom"} done))
        (is (= "errored" (tasks/task-status done)))))))

(deftest auto-import-test
  (remote-sync.tu/with-sync-cleanup
    (remote-sync.tu/do-with-git-repo! (fn [_repo]
                                        (mt/with-temp [:model/Collection synced {:name "Synced" :is_remote_synced true :location "/"}
                                                       :model/Card       card   {:name "Synced card" :collection_id (:id synced)}]
                                          (sync/export! {})
                                          (let [commit (settings/remote-sync-last-synced-commit)]
                                            (testing "nothing runs while scheduled imports are off"
                                              (is (nil? (tasks/auto-import!))))
                                            (mt/with-temporary-setting-values [remote-sync-auto-import true
                                                                               remote-sync-type        :read-only]
                                              (testing "nothing runs when the branch has no new commit"
                                                (is (nil? (tasks/auto-import!))))
                                              (testing "a read-only instance imports a new commit, discarding local drift"
                                                (t2/update! :model/Card (:id card) {:name "Drifted"})
                                                (settings/remote-sync-last-synced-commit! "0000000000000000000000000000000000000000")
                                                (settings/remote-sync-last-auto-import-check! nil)
                                                (let [task (tasks/auto-import!)]
                                                  (is (=? {:sync_task_type :import, :initiated_by nil, :version commit} task))
                                                  (is (= "successful" (tasks/task-status task))))
                                                (is (= "Synced card" (t2/select-one-fn :name :model/Card :id (:id card)))))
                                              (testing "the next check waits for the interval"
                                                (settings/remote-sync-last-synced-commit! "0000000000000000000000000000000000000000")
                                                (is (nil? (tasks/auto-import!)))))))))))

(deftest auto-import-records-an-unreachable-repository-test
  (mt/with-model-cleanup [:model/GitSyncTask]
    (mt/with-temporary-setting-values [remote-sync-url                    "/nonexistent/repository.git"
                                       remote-sync-auto-import            true
                                       remote-sync-last-auto-import-check nil]
      (is (nil? (tasks/auto-import!)))
      (is (=? {:sync_task_type :import, :error_message #"Git operation failed.*"}
              (remote-sync.db/latest-task))))))
