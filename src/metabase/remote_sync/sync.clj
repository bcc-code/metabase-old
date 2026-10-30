(ns metabase.remote-sync.sync
  "Exporting the synced content to the repository and importing it back, each on a fresh checkout of the branch in a
  temporary directory.

  The commit this instance last matched (after its last export or import) is how both sides tell what changed: an
  export refuses to overwrite changes the branch got since then, and an import refuses to overwrite changes made here
  since then, unless forced."
  (:require
   [babashka.fs :as fs]
   [clojure.string :as str]
   [metabase.remote-sync.changes :as changes]
   [metabase.remote-sync.content :as content]
   [metabase.remote-sync.git :as git]
   [metabase.remote-sync.settings :as settings]
   [metabase.remote-sync.storage :as storage]
   [metabase.util.i18n :refer [tru]]
   [metabase.util.log :as log]
   [toucan2.core :as t2])
  (:import
   (java.io File)))

(set! *warn-on-reflection* true)

(defn conflict
  "An `ex-info` for a sync that would overwrite changes: `kind` is `:remote-changed` (an export, when the branch
  changed) or `:local-changes` (an import, when synced content changed here), and `conflicts` labels the changes."
  [message kind conflicts]
  (ex-info message {:status-code   409
                    ::conflict     kind
                    :conflicts     (vec conflicts)}))

(defn- check-configured! []
  (when-not (settings/remote-sync-enabled)
    (throw (ex-info (tru "Git sync is not set up. Connect a repository first.") {:status-code 400}))))

(defn- do-with-work-dir [f]
  (let [dir (fs/create-temp-dir {:prefix "metabase-git-sync-"})]
    (try
      (f (fs/file dir))
      (finally
        (try
          (fs/delete-tree dir)
          (catch Exception e
            (log/warnf e "Git sync: could not delete the working directory %s" dir)))))))

(defn- baseline-files
  "The managed files of the commit this instance last matched: `{}` when it never synced, nil when the checkout doesn't
  have that commit (the branch history was rewritten)."
  [git-repo last-commit]
  (if (str/blank? last-commit)
    {}
    (git/tree-files git-repo last-commit storage/managed-dirs)))

(defn- changed-paths
  "The managed files that differ between the checked-out commit and the commit this instance last matched, or `:all`
  when that commit is unknown."
  [git-repo last-commit]
  (let [tip (git/head-commit git-repo)]
    (if (or (nil? tip) (= tip last-commit))
      []
      (let [current  (git/tree-files git-repo tip storage/managed-dirs)
            baseline (baseline-files git-repo last-commit)]
        (cond
          (nil? baseline)      (if (empty? current) [] :all)
          (= current baseline) []
          :else                (sort (filter #(not= (get current %) (get baseline %))
                                             (distinct (concat (keys current) (keys baseline))))))))))

(defn- change-label [{:keys [model name sync_status]}]
  (str (case sync_status
         "create" (tru "New")
         "update" (tru "Changed")
         "delete" (tru "Deleted")
         sync_status)
       " " model ": " name))

(defn- person-name [{:keys [first_name last_name email]}]
  (or (not-empty (str/trim (str first_name " " last_name))) email))

(defn- commit-identity
  "The author and committer of an export started by `user` (nil for none)."
  [user]
  (let [committer-name  (or (not-empty (settings/remote-sync-author-name)) "Metabase")
        committer-email (or (not-empty (settings/remote-sync-author-email)) "metabase@localhost")]
    {:author-name     (or (some-> user person-name) committer-name)
     :author-email    (or (:email user) committer-email)
     :committer-name  committer-name
     :committer-email committer-email}))

(defn- default-commit-message [change-count]
  (tru "Update Metabase content ({0} changes)" change-count))

(defn export!
  "Commit the synced content to the branch and push it. Options:

  - `:message`   the commit message
  - `:force?`    overwrite changes the branch got since this instance last synced, rather than refusing
  - `:user`      the user exporting (`:first_name`, `:last_name`, `:email`), the commit author
  - `:progress!` called with the fraction done

  Returns `{:commit sha, :outcome {:kind \"pushed\"|\"push-skipped\", ...}}`."
  [{:keys [message force? user progress!] :or {progress! (constantly nil)}}]
  (check-configured!)
  (let [{:keys [branch] :as config} (settings/git-config)]
    (do-with-work-dir
     (fn [^File dir]
       (with-open [repo (git/check-out! config dir)]
         (progress! 0.1)
         (let [tip     (git/head-commit repo)
               changed (changed-paths repo (settings/remote-sync-last-synced-commit))]
           (when (and (seq changed) (not force?))
             (throw (conflict (tru "The branch {0} has changes that aren''t imported here yet. Import them first, or export anyway to overwrite them."
                                   branch)
                              :remote-changed
                              (if (= changed :all) [] changed))))
           (let [rendered     (changes/current-content)
                 change-count (count (changes/diff rendered (changes/snapshot)))]
             (progress! 0.5)
             (storage/clear-managed-dirs! dir)
             (doseq [{:keys [path yaml]} rendered]
               (storage/write-file! dir path yaml))
             (progress! 0.7)
             (let [commit (git/commit-all! repo (merge (commit-identity user)
                                                       {:message (or (not-empty (some-> message str/trim))
                                                                     (default-commit-message change-count))}))]
               (when commit
                 (git/push! repo config))
               (progress! 0.9)
               (changes/save-snapshot! rendered)
               (settings/remote-sync-last-synced-commit! (or commit tip))
               (log/infof "Git sync: exported %d entities to %s (%s)" (count rendered) branch (or commit "no changes"))
               {:commit  (or commit tip)
                :outcome (if commit
                           {:kind "pushed", :count change-count, :branch branch}
                           {:kind "push-skipped"})}))))))))

(defn import!
  "Load the content of the branch into this instance, removing synced entities the branch no longer has. Options:

  - `:force?`    overwrite the synced content changed here since this instance last synced, rather than refusing,
                 and reload even when the branch didn't change
  - `:progress!` called with the fraction done

  Returns `{:commit sha, :outcome {:kind \"pulled\"|\"pull-skipped\", ...}}`."
  [{:keys [force? progress!] :or {progress! (constantly nil)}}]
  (check-configured!)
  (let [{:keys [branch] :as config} (settings/git-config)]
    (do-with-work-dir
     (fn [^File dir]
       (with-open [repo (git/check-out! config dir)]
         (progress! 0.1)
         (let [tip (git/head-commit repo)]
           (when-not tip
             (throw (ex-info (tru "The branch {0} doesn''t exist in the repository yet. Export to create it." branch)
                             {:status-code 400})))
           (if (and (not force?)
                    (empty? (changed-paths repo (settings/remote-sync-last-synced-commit))))
             (do
               (settings/remote-sync-last-synced-commit! tip)
               {:commit tip, :outcome {:kind "pull-skipped"}})
             (do
               (when-not force?
                 (when-let [local (not-empty (changes/local-changes))]
                   (throw (conflict (tru "Synced content changed here since the last sync. Export it first, or import anyway to discard the changes.")
                                    :local-changes
                                    (map change-label local)))))
               (let [entities (storage/read-entities dir)]
                 (progress! 0.2)
                 (t2/with-transaction [_conn]
                   (content/load-entities! entities #(progress! (+ 0.2 (* 0.6 (double %)))))
                   (progress! 0.8)
                   (content/delete-missing! entities)
                   (changes/save-snapshot! (changes/current-content)))
                 (settings/remote-sync-last-synced-commit! tip)
                 (log/infof "Git sync: imported %d entities from %s (%s)" (count entities) branch tip)
                 {:commit  tip
                  :outcome {:kind "pulled", :count (count entities), :branch branch}})))))))))
