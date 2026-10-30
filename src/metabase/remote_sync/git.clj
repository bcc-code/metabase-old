(ns metabase.remote-sync.git
  "The Git operations Git sync needs, on top of JGit: list a remote's branches, check a branch out into a working
  directory, commit everything in it and push it back.

  A `config` is a map of `:url` (HTTPS URL of the repository), `:branch` and an optional `:token`, sent as the
  password of HTTP basic auth. The user name is the one in the URL (`https://user@host/...`), or `x-access-token`,
  which GitHub, GitLab, Gitea and Azure DevOps all accept for a personal access token."
  (:require
   [clojure.string :as str]
   [metabase.util.i18n :refer [tru]]
   [metabase.util.log :as log])
  (:import
   (java.io File)
   (java.net URISyntaxException)
   (org.eclipse.jgit.api Git)
   (org.eclipse.jgit.api.errors GitAPIException)
   (org.eclipse.jgit.errors MissingObjectException)
   (org.eclipse.jgit.lib ObjectId Ref Repository)
   (org.eclipse.jgit.revwalk RevCommit RevWalk)
   (org.eclipse.jgit.transport CredentialsProvider PushResult RefSpec RemoteRefUpdate RemoteRefUpdate$Status
                               URIish UsernamePasswordCredentialsProvider)
   (org.eclipse.jgit.treewalk TreeWalk)))

(set! *warn-on-reflection* true)

(def ^:private default-user-name "x-access-token")

(def ^:private timeout-seconds
  "How long a network operation may wait on the remote before failing."
  120)

(defn- branch-ref ^String [branch]
  (str "refs/heads/" branch))

(defn- credentials-provider ^CredentialsProvider [{:keys [url token]}]
  (when-not (str/blank? token)
    (let [^String user-name (or (not-empty (try
                                             (.getUser (URIish. ^String url))
                                             (catch URISyntaxException _ nil)))
                                default-user-name)]
      (UsernamePasswordCredentialsProvider. user-name ^String token))))

(defn- redact
  "`message` with every occurrence of `token` masked, since JGit can echo URLs and credentials in its errors."
  [message token]
  (cond-> (str message)
    (not (str/blank? token)) (str/replace token "********")))

(defn- root-cause-message [^Throwable e]
  (loop [^Throwable e e]
    (if-let [cause (ex-cause e)]
      (recur cause)
      (or (ex-message e) (.getName (class e))))))

(defn do-with-git-errors
  "Calls `thunk`, turning the errors JGit throws into an `ex-info` with a 400 status code and a message free of the
  token in `config`."
  [config thunk]
  (try
    (thunk)
    (catch GitAPIException e
      (let [cause-message (some-> (ex-cause e) root-cause-message)
            message       (redact (cond-> (str (ex-message e))
                                    (and cause-message (not (str/includes? (str (ex-message e)) cause-message)))
                                    (str " (" cause-message ")"))
                                  (:token config))]
        (log/warnf "Git sync: Git operation failed: %s" message)
        (throw (ex-info (tru "Git operation failed: {0}" message)
                        {:status-code 400, ::error :git}))))
    (catch URISyntaxException e
      (throw (ex-info (tru "The repository URL is not valid: {0}" (redact (ex-message e) (:token config)))
                      {:status-code 400, ::error :invalid-url})))
    (catch org.eclipse.jgit.api.errors.JGitInternalException e
      (let [message (redact (root-cause-message e) (:token config))]
        (log/warnf "Git sync: Git operation failed: %s" message)
        (throw (ex-info (tru "Git operation failed: {0}" message)
                        {:status-code 400, ::error :git}))))))

(defmacro ^:private with-git-errors
  [config & body]
  `(do-with-git-errors ~config (fn [] ~@body)))

(defn remote-heads
  "A map of branch name to commit SHA for every branch of the repository in `config`. Throws when the repository
  can't be reached or the credentials are refused."
  [{:keys [url] :as config}]
  (with-git-errors config
    (let [command (doto (Git/lsRemoteRepository)
                    (.setRemote ^String url)
                    (.setHeads true)
                    (.setTags false)
                    (.setCredentialsProvider (credentials-provider config))
                    (.setTimeout (int timeout-seconds)))]
      (into (sorted-map)
            (keep (fn [^Ref ref]
                    (let [ref-name (.getName ref)]
                      (when (str/starts-with? ref-name "refs/heads/")
                        [(subs ref-name (count "refs/heads/")) (some-> (.getObjectId ref) .getName)]))))
            (.call command)))))

(defn remote-branch-commit
  "The SHA of the commit at the tip of the branch in `config`, or nil when the branch doesn't exist yet."
  [{:keys [branch] :as config}]
  (get (remote-heads config) branch))

(defn head-commit
  "The SHA of the commit `git` has checked out, or nil when its branch has no commits yet."
  [^Git git]
  (some-> (.resolve (.getRepository git) "HEAD") .getName))

(defn- isolate-from-user-config!
  "Overrides, in the repository's own config, the settings of the server's global Git config that would change what
  Git sync commits or stop it committing at all (commit signing, line-ending conversion)."
  ^Git [^Git git]
  (doto (.getConfig (.getRepository git))
    (.setBoolean "commit" nil "gpgsign" false)
    (.setString "core" nil "autocrlf" "false")
    (.save))
  git)

(defn check-out!
  "Puts the tip of the branch in `config` into the empty directory `dir` and returns the open `Git` (close it when
  done). When the branch doesn't exist on the remote, `dir` becomes an empty repository whose first commit starts the
  branch."
  ^Git [{:keys [url branch] :as config} ^File dir]
  (with-git-errors config
    (isolate-from-user-config!
     (if (remote-branch-commit config)
       (let [^java.util.Collection branches [(branch-ref branch)]]
         (.call (doto (Git/cloneRepository)
                  (.setURI ^String url)
                  (.setDirectory dir)
                  (.setBranch (branch-ref branch))
                  (.setBranchesToClone branches)
                  (.setCloneAllBranches false)
                  (.setNoTags)
                  (.setCredentialsProvider (credentials-provider config))
                  (.setTimeout (int timeout-seconds)))))
       (.call (doto (Git/init)
                (.setDirectory dir)
                (.setInitialBranch ^String branch)))))))

(defn commit-all!
  "Stages every change in the working directory of `git`, deletions included, and commits it. Returns the SHA of the
  new commit, or nil when there was nothing to commit."
  [^Git git {:keys [message author-name author-email committer-name committer-email]}]
  (with-git-errors nil
    (.call (doto (.add git) (.addFilepattern ".")))
    (.call (doto (.add git) (.addFilepattern ".") (.setUpdate true)))
    (when-not (.isClean (.call (.status git)))
      (let [^RevCommit commit (.call (doto (.commit git)
                                       (.setMessage ^String message)
                                       (.setAuthor ^String author-name ^String author-email)
                                       (.setCommitter ^String committer-name ^String committer-email)
                                       (.setSign Boolean/FALSE)
                                       (.setNoVerify true)))]
        (.getName commit)))))

(defn- rejected-updates [results]
  (for [^PushResult result results
        ^RemoteRefUpdate update (.getRemoteUpdates result)
        :let [status (.getStatus update)]
        :when (not (contains? #{RemoteRefUpdate$Status/OK RemoteRefUpdate$Status/UP_TO_DATE} status))]
    {:status  status
     :message (.getMessage update)}))

(defn push!
  "Pushes the checked-out commit of `git` to the branch in `config`. Throws an `ex-info` with `::error`
  `:push-rejected` when the remote refuses it, for instance because the branch moved on since it was checked out."
  [^Git git {:keys [url branch token] :as config}]
  (with-git-errors config
    (let [^java.util.List specs [(RefSpec. (str "HEAD:" (branch-ref branch)))]
          results (.call (doto (.push git)
                           (.setRemote ^String url)
                           (.setRefSpecs specs)
                           (.setCredentialsProvider (credentials-provider config))
                           (.setTimeout (int timeout-seconds))))]
      (when-let [rejected (seq (rejected-updates results))]
        (let [{:keys [status message]} (first rejected)]
          (throw (ex-info (if (= status RemoteRefUpdate$Status/REJECTED_NONFASTFORWARD)
                            (tru "The branch {0} changed while exporting. Try again." branch)
                            (tru "The remote refused the push: {0}" (redact (or message (str status)) token)))
                          {:status-code 409
                           ::error      :push-rejected
                           :push-status (str status)})))))))

(defn- under-prefix? [path prefixes]
  (some #(str/starts-with? path %) prefixes))

(defn tree-files
  "A map of path to blob SHA of the files under any of `prefixes` (directory names ending in `/`) in the commit
  `commit-sha` of `git`, or nil when `git` doesn't have that commit."
  [^Git git commit-sha prefixes]
  (let [^Repository repo (.getRepository git)]
    (when-let [^ObjectId commit-id (and commit-sha
                                        (try
                                          (.resolve repo ^String commit-sha)
                                          (catch Exception _ nil)))]
      (try
        (with-open [walk (RevWalk. repo)
                    tree (TreeWalk. repo)]
          (.addTree tree (.getTree (.parseCommit walk commit-id)))
          (.setRecursive tree true)
          (loop [acc {}]
            (if (.next tree)
              (let [path (.getPathString tree)]
                (recur (cond-> acc
                         (under-prefix? path prefixes) (assoc path (.getName (.getObjectId tree 0))))))
              acc)))
        (catch MissingObjectException _
          nil)))))
