(ns metabase.remote-sync.test-util
  "Test utilities for remote sync."
  (:require
   [babashka.fs :as fs]
   [clojure.java.io :as io]
   [clojure.string :as str]
   [metabase.remote-sync.core :as remote-sync]
   [metabase.remote-sync.git :as git]
   [metabase.test :as mt]
   [metabase.util :as u])
  (:import
   (java.io File)
   (org.eclipse.jgit.api Git)))

(set! *warn-on-reflection* true)

(defn allow-remote-synced-collections
  "Test fixture that lets every collection be remote-synced, as with custom collections on."
  [thunk]
  (mt/with-dynamic-fn-redefs [remote-sync/collection-syncable? (constantly true)]
    (thunk)))

(defn do-with-git-repo!
  "Create an empty bare Git repository in a temporary directory, point Git sync at it (branch `main`, read-write, never
  synced), and call `f` with its directory."
  [f]
  (let [root (fs/file (fs/create-temp-dir {:prefix "git-sync-test-"}))
        bare (io/file root "remote.git")]
    (try
      (with-open [_repo (.call (doto (Git/init)
                                 (.setBare true)
                                 (.setDirectory bare)
                                 (.setInitialBranch "main")))])
      (mt/with-temporary-setting-values [remote-sync-url                    (.getAbsolutePath bare)
                                         remote-sync-branch                 "main"
                                         remote-sync-token                  nil
                                         remote-sync-type                   :read-write
                                         remote-sync-auto-import            false
                                         remote-sync-auto-import-interval   15
                                         remote-sync-last-synced-commit     nil
                                         remote-sync-last-auto-import-check nil]
        (f bare))
      (finally
        (fs/delete-tree root)))))

(defmacro with-sync-cleanup
  "Run `body`, then delete the synced content, snapshot and tasks it created, including what imports created."
  [& body]
  `(mt/with-model-cleanup [:model/GitSyncEntity
                           :model/GitSyncTask
                           :model/DashboardCard
                           :model/DashboardTab
                           :model/Dashboard
                           :model/TimelineEvent
                           :model/Timeline
                           :model/Document
                           :model/Action
                           :model/Card
                           :model/NativeQuerySnippet
                           :model/Collection]
     ~@body))

(defn- git-config [^File bare]
  {:url (.getAbsolutePath bare), :branch "main"})

(def ^:private other-identity
  {:message         "Change made elsewhere"
   :author-name     "Someone Else"
   :author-email    "someone@example.com"
   :committer-name  "Someone Else"
   :committer-email "someone@example.com"})

(defn do-with-other-checkout!
  "Check the `main` branch of the bare repository `bare` out into a temporary directory, as another instance or a
  person would, call `f` with that directory, then commit what `f` changed and push it. Returns the new commit, or nil
  when `f` changed nothing."
  [^File bare f]
  (let [dir (fs/file (fs/create-temp-dir {:prefix "git-sync-other-"}))]
    (try
      (with-open [repo (git/check-out! (git-config bare) dir)]
        (f dir)
        (u/prog1 (git/commit-all! repo other-identity)
          (when <>
            (git/push! repo (git-config bare)))))
      (finally
        (fs/delete-tree dir)))))

(defn repo-files!
  "A map of path to content of the files on the `main` branch of the bare repository `bare`, except Git's own."
  [^File bare]
  (let [dir (fs/file (fs/create-temp-dir {:prefix "git-sync-read-"}))]
    (try
      (with-open [_repo (git/check-out! (git-config bare) dir)]
        (into {}
              (for [p (fs/glob dir "**")
                    :when (fs/regular-file? p)
                    :let [path (str (fs/relativize (fs/path dir) p))]
                    :when (not (str/starts-with? path ".git/"))]
                [path (slurp (fs/file p))])))
      (finally
        (fs/delete-tree dir)))))
