(ns metabase.remote-sync.settings
  "Settings for Git sync: the repository content is synced with and how this instance syncs with it."
  (:require
   [clojure.string :as str]
   [metabase.settings.core :as setting :refer [defsetting]]
   [metabase.util.i18n :refer [deferred-tru tru]]))

(set! *warn-on-reflection* true)

(defsetting remote-sync-url
  (deferred-tru "The HTTPS URL of the Git repository that synced collections are exported to and imported from.")
  :type       :string
  :visibility :admin
  :export?    false
  :encryption :no
  :audit      :no-value)

(defsetting remote-sync-token
  (deferred-tru "The access token Metabase uses to read from and push to the Git repository.")
  :type       :string
  :visibility :admin
  :sensitive? true
  :export?    false
  :encryption :when-encryption-key-set
  :audit      :no-value)

(defsetting remote-sync-branch
  (deferred-tru "The branch of the Git repository that synced collections are exported to and imported from.")
  :type       :string
  :default    "main"
  :visibility :admin
  :export?    false
  :encryption :no
  :audit      :getter)

(def sync-types
  "The ways this instance can sync with the repository: `:read-write` exports and imports, `:read-only` only imports
  and keeps synced content from being edited here."
  #{:read-write :read-only})

(defsetting remote-sync-type
  (deferred-tru "Whether this instance edits synced content and exports it (read-write), or only imports it (read-only).")
  :type       :keyword
  :default    :read-write
  :visibility :authenticated
  :export?    false
  :audit      :getter
  :setter     (fn [new-value]
                (when (some? new-value)
                  (when-not (contains? sync-types (keyword new-value))
                    (throw (ex-info (tru "Invalid Git sync mode: {0}" (pr-str new-value))
                                    {:status-code 400}))))
                (setting/set-value-of-type! :keyword :remote-sync-type new-value)))

(defsetting remote-sync-enabled
  (deferred-tru "Whether a Git repository is connected for Git sync.")
  :type       :boolean
  :visibility :authenticated
  :export?    false
  :setter     :none
  :getter     (fn []
                (not (str/blank? (remote-sync-url)))))

(defsetting remote-sync-auto-import
  (deferred-tru "Whether this instance imports new commits from the Git repository on a schedule.")
  :type       :boolean
  :default    false
  :visibility :admin
  :export?    false
  :audit      :getter)

(def min-auto-import-interval-minutes
  "The shortest interval between scheduled imports, in minutes."
  1)

(def max-auto-import-interval-minutes
  "The longest interval between scheduled imports, in minutes (one day)."
  1440)

(defsetting remote-sync-auto-import-interval
  (deferred-tru "How often, in minutes, this instance checks the Git repository for new commits to import.")
  :type       :integer
  :default    15
  :visibility :admin
  :export?    false
  :audit      :getter)

(defsetting remote-sync-author-name
  (deferred-tru "The committer name of the commits Git sync pushes.")
  :type       :string
  :default    "Metabase"
  :visibility :admin
  :export?    false
  :encryption :no
  :audit      :getter)

(defsetting remote-sync-author-email
  (deferred-tru "The committer email address of the commits Git sync pushes.")
  :type       :string
  :default    "metabase@localhost"
  :visibility :admin
  :export?    false
  :encryption :no
  :audit      :getter)

(defsetting remote-sync-last-synced-commit
  (deferred-tru "The commit of the Git repository that synced content last matched, after an export or an import.")
  :type       :string
  :visibility :internal
  :export?    false
  :encryption :no
  :audit      :never
  :doc        false)

(defsetting remote-sync-last-auto-import-check
  (deferred-tru "When this instance last checked the Git repository for commits to import on its schedule.")
  :type       :timestamp
  :visibility :internal
  :export?    false
  :encryption :no
  :audit      :never
  :doc        false)

(defn read-only?
  "Whether a repository is connected and this instance only imports from it, so synced content can't be edited here."
  []
  (and (remote-sync-enabled)
       (= :read-only (remote-sync-type))))

(defn git-config
  "The repository settings as the `config` map that [[metabase.remote-sync.git]] takes."
  []
  {:url    (remote-sync-url)
   :branch (or (not-empty (remote-sync-branch)) "main")
   :token  (remote-sync-token)})
