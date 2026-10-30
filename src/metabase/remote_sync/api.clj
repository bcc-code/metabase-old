(ns metabase.remote-sync.api
  "`/api/remote-sync` endpoints for Git sync. All of them are for admins only."
  (:require
   [clojure.string :as str]
   [metabase.api.common :as api]
   [metabase.api.macros :as api.macros]
   [metabase.remote-sync.changes :as changes]
   [metabase.remote-sync.db :as remote-sync.db]
   [metabase.remote-sync.git :as git]
   [metabase.remote-sync.settings :as settings]
   [metabase.remote-sync.synced-collections :as synced-collections]
   [metabase.remote-sync.tasks :as tasks]
   [metabase.util.i18n :refer [tru]]
   [metabase.util.malli.registry :as mr]
   [metabase.util.malli.schema :as ms]))

(set! *warn-on-reflection* true)

;;; --------------------------------------------------- Schemas ----------------------------------------------------

(mr/def ::settings
  "The Git sync settings, without the token."
  [:map {:closed true}
   [:enabled              :boolean]
   [:url                  [:maybe :string]]
   [:branch               :string]
   [:token_set            :boolean]
   [:type                 [:enum "read-write" "read-only"]]
   [:auto_import          :boolean]
   [:auto_import_interval :int]
   [:author_name          [:maybe :string]]
   [:author_email         [:maybe :string]]])

(mr/def ::task-user
  [:map {:closed true}
   [:id         ms/PositiveInt]
   [:first_name [:maybe :string]]
   [:last_name  [:maybe :string]]
   [:email      :string]])

(mr/def ::task-outcome
  [:map {:closed true}
   [:kind   :string]
   [:count  {:optional true} :int]
   [:branch {:optional true} :string]])

(mr/def ::task
  "A Git sync export or import."
  [:map {:closed true}
   [:id                      ms/PositiveInt]
   [:sync_task_type          [:enum "import" "export"]]
   [:status                  [:enum "running" "successful" "conflict" "errored" "timed-out" "cancelled"]]
   [:progress                [:maybe number?]]
   [:started_at              [:maybe ms/TemporalInstant]]
   [:ended_at                [:maybe ms/TemporalInstant]]
   [:last_progress_report_at [:maybe ms/TemporalInstant]]
   [:last_heartbeat_at       [:maybe ms/TemporalInstant]]
   [:error_message           [:maybe :string]]
   [:version                 [:maybe :string]]
   [:outcome                 [:maybe ::task-outcome]]
   [:conflicts               [:sequential :string]]
   [:initiated_by            [:maybe ms/PositiveInt]]
   [:initiated_by_user       [:maybe ::task-user]]])

(mr/def ::status
  "Where Git sync stands."
  [:map {:closed true}
   [:enabled            :boolean]
   [:url                [:maybe :string]]
   [:branch             :string]
   [:type               [:enum "read-write" "read-only"]]
   [:auto_import        :boolean]
   [:last_synced_commit [:maybe :string]]
   [:current_task       [:maybe ::task]]
   [:latest_task        [:maybe ::task]]
   [:last_import        [:maybe ::task]]
   [:last_export        [:maybe ::task]]])

(mr/def ::change
  "A synced entity changed here since the last sync."
  [:map {:closed true}
   [:id            ms/PositiveInt]
   [:name          [:maybe :string]]
   [:model         :string]
   [:collection_id [:maybe ms/PositiveInt]]
   [:display       [:maybe :string]]
   [:sync_status   [:enum "create" "update" "delete"]]])

(mr/def ::synced-collection
  [:map {:closed true}
   [:id               ms/PositiveInt]
   [:name             :string]
   [:description      [:maybe :string]]
   [:is_remote_synced :boolean]])

;;; --------------------------------------------------- Helpers ----------------------------------------------------

(defn- current-settings []
  {:enabled              (boolean (settings/remote-sync-enabled))
   :url                  (settings/remote-sync-url)
   :branch               (or (not-empty (settings/remote-sync-branch)) "main")
   :token_set            (not (str/blank? (settings/remote-sync-token)))
   :type                 (name (or (settings/remote-sync-type) :read-write))
   :auto_import          (boolean (settings/remote-sync-auto-import))
   :auto_import_interval (or (settings/remote-sync-auto-import-interval) 15)
   :author_name          (settings/remote-sync-author-name)
   :author_email         (settings/remote-sync-author-email)})

(defn- present-tasks
  "`tasks` as the API returns them, with their status and the user who started each."
  [tasks]
  (let [users (remote-sync.db/users-by-id (into #{} (keep :initiated_by) tasks))]
    (for [{:keys [initiated_by outcome conflicts sync_task_type] :as task} tasks]
      (-> (select-keys task [:id :progress :started_at :ended_at :last_progress_report_at :last_heartbeat_at
                             :error_message :version :initiated_by])
          (assoc :sync_task_type    (name sync_task_type)
                 :status            (tasks/task-status task)
                 :outcome           (when (:kind outcome)
                                      (select-keys outcome [:kind :count :branch]))
                 :conflicts         (vec (filter string? conflicts))
                 :initiated_by_user (some-> (get users initiated_by)
                                            (select-keys [:id :first_name :last_name :email])))))))

(defn- present-task [task]
  (when task
    (first (present-tasks [task]))))

(defn- check-url! [url]
  (when-not (re-find #"(?i)^https?://\S+$" (str url))
    (throw (ex-info (tru "Enter the HTTPS URL of the repository, like https://github.com/your-org/metabase-content.git.")
                    {:status-code 400}))))

(defn- check-branch! [branch]
  (when (or (str/blank? branch)
            (re-find #"\s|\.\.|[~^:?*\[\\]|^/|/$|\.lock$|^-" branch))
    (throw (ex-info (tru "{0} is not a valid branch name." (pr-str branch))
                    {:status-code 400}))))

(defn- connection-check
  "Connect to the repository in `config`, returning its branches and whether `config`'s branch is one of them."
  [{:keys [branch] :as config}]
  (let [branches (vec (keys (git/remote-heads config)))]
    {:branches      branches
     :branch_exists (boolean (some #{branch} branches))}))

;;; -------------------------------------------------- Endpoints ---------------------------------------------------

(api.macros/defendpoint :get "/settings" :- ::settings
  "The Git sync settings. The token isn't returned, only whether one is set."
  []
  (api/check-superuser)
  (current-settings))

(api.macros/defendpoint :put "/settings" :- [:map {:closed true}
                                             [:settings ::settings]
                                             [:branches [:sequential :string]]
                                             [:branch_exists :boolean]]
  "Connect a repository, or change how this instance syncs with it. Checks that the repository can be reached with the
  token before saving anything. Omit `token` to keep the saved one."
  [_route-params
   _query-params
   {:keys [url branch token type auto_import auto_import_interval author_name author_email]}
   :- [:map {:closed true}
       [:url                  ms/NonBlankString]
       [:branch               ms/NonBlankString]
       [:token                {:optional true} [:maybe :string]]
       [:type                 {:optional true} [:enum "read-write" "read-only"]]
       [:auto_import          {:optional true} :boolean]
       [:auto_import_interval {:optional true} [:int {:min settings/min-auto-import-interval-minutes
                                                      :max settings/max-auto-import-interval-minutes}]]
       [:author_name          {:optional true} [:maybe :string]]
       [:author_email         {:optional true} [:maybe ms/Email]]]]
  (api/check-superuser)
  (let [url    (str/trim url)
        branch (str/trim branch)
        token  (if (some? token) (str/trim token) (settings/remote-sync-token))]
    (check-url! url)
    (check-branch! branch)
    (let [check (connection-check {:url url, :branch branch, :token token})]
      (when (or (not= url (settings/remote-sync-url))
                (not= branch (settings/remote-sync-branch)))
        (settings/remote-sync-last-synced-commit! nil))
      (settings/remote-sync-url! url)
      (settings/remote-sync-branch! branch)
      (settings/remote-sync-token! (not-empty token))
      (when type
        (settings/remote-sync-type! (keyword type)))
      (when (some? auto_import)
        (settings/remote-sync-auto-import! auto_import))
      (when auto_import_interval
        (settings/remote-sync-auto-import-interval! auto_import_interval))
      (when (some? author_name)
        (settings/remote-sync-author-name! (not-empty (str/trim author_name))))
      (when (some? author_email)
        (settings/remote-sync-author-email! (not-empty (str/trim author_email))))
      (assoc check :settings (current-settings)))))

(api.macros/defendpoint :delete "/settings" :- ::settings
  "Disconnect the repository. Collections stay marked as synced, so connecting again picks up where this left off."
  []
  (api/check-superuser)
  (settings/remote-sync-url! nil)
  (settings/remote-sync-token! nil)
  (settings/remote-sync-branch! nil)
  (settings/remote-sync-type! nil)
  (settings/remote-sync-auto-import! nil)
  (settings/remote-sync-last-synced-commit! nil)
  (changes/forget-last-sync!)
  (current-settings))

(api.macros/defendpoint :post "/test-connection" :- [:map {:closed true}
                                                     [:branches [:sequential :string]]
                                                     [:branch_exists :boolean]]
  "Check that the repository at `url` can be reached with `token` (the saved token when omitted), and list its
  branches."
  [_route-params
   _query-params
   {:keys [url branch token]} :- [:map {:closed true}
                                  [:url    ms/NonBlankString]
                                  [:branch {:optional true} [:maybe :string]]
                                  [:token  {:optional true} [:maybe :string]]]]
  (api/check-superuser)
  (let [url (str/trim url)]
    (check-url! url)
    (connection-check {:url    url
                       :branch (or (some-> branch str/trim not-empty) "main")
                       :token  (if (some? token) (str/trim token) (settings/remote-sync-token))})))

(api.macros/defendpoint :get "/status" :- ::status
  "Where Git sync stands: its settings, the commit last synced, and the running and latest exports and imports."
  []
  (api/check-superuser)
  (let [latest (remote-sync.db/latest-task)]
    {:enabled            (boolean (settings/remote-sync-enabled))
     :url                (settings/remote-sync-url)
     :branch             (or (not-empty (settings/remote-sync-branch)) "main")
     :type               (name (or (settings/remote-sync-type) :read-write))
     :auto_import        (boolean (settings/remote-sync-auto-import))
     :last_synced_commit (settings/remote-sync-last-synced-commit)
     :current_task       (when (and latest (= "running" (tasks/task-status latest)))
                           (present-task latest))
     :latest_task        (present-task latest)
     :last_import        (present-task (remote-sync.db/latest-successful-task :import))
     :last_export        (present-task (remote-sync.db/latest-successful-task :export))}))

(api.macros/defendpoint :get "/task/:id" :- ::task
  "The Git sync export or import with `id`."
  [{:keys [id]} :- [:map {:closed true} [:id ms/PositiveInt]]]
  (api/check-superuser)
  (present-task (api/check-404 (remote-sync.db/task id))))

(api.macros/defendpoint :get "/changes" :- [:map {:closed true}
                                            [:dirty [:sequential ::change]]
                                            [:changed_collections [:map-of ms/PositiveInt :boolean]]]
  "The synced entities changed here since this instance last matched the repository, and the Collections holding
  them."
  []
  (api/check-superuser)
  (if (settings/remote-sync-enabled)
    (let [dirty (changes/local-changes)]
      {:dirty               dirty
       :changed_collections (changes/changed-collections dirty)})
    {:dirty [], :changed_collections {}}))

(api.macros/defendpoint :post "/export" :- ::task
  "Start committing the synced content to the branch and pushing it. Without `force`, the export stops rather than
  overwrite changes the branch got since this instance last synced."
  [_route-params
   _query-params
   {:keys [message force]} :- [:map {:closed true}
                               [:message {:optional true} [:maybe :string]]
                               [:force   {:optional true} [:maybe :boolean]]]]
  (api/check-superuser)
  (api/check-400 (settings/remote-sync-enabled) (tru "Git sync is not set up. Connect a repository first."))
  (api/check-400 (not (settings/read-only?)) (tru "This instance only imports from Git, so it can''t export."))
  (present-task (tasks/start-export! (select-keys @api/*current-user* [:id :first_name :last_name :email])
                                     {:message message, :force? (boolean force)})))

(api.macros/defendpoint :post "/import" :- ::task
  "Start loading the content of the branch. Without `force`, the import stops rather than overwrite synced content
  changed here since this instance last synced; with it, those changes are discarded."
  [_route-params
   _query-params
   {:keys [force]} :- [:maybe [:map {:closed true}
                               [:force {:optional true} [:maybe :boolean]]]]]
  (api/check-superuser)
  (api/check-400 (settings/remote-sync-enabled) (tru "Git sync is not set up. Connect a repository first."))
  (present-task (tasks/start-import! api/*current-user-id* {:force? (boolean force)})))

(api.macros/defendpoint :get "/collections" :- [:sequential ::synced-collection]
  "The top-level Collections that can be synced, with whether they are."
  []
  (api/check-superuser)
  (for [collection (synced-collections/top-level-collections)]
    (-> (select-keys collection [:id :name :description])
        (assoc :is_remote_synced (boolean (api/bit->boolean (:is_remote_synced collection)))))))

(api.macros/defendpoint :put "/collection/:id" :- ::synced-collection
  "Sync the top-level Collection with `id`, and everything under it, or stop syncing it."
  [{:keys [id]} :- [:map {:closed true} [:id ms/PositiveInt]]
   _query-params
   {:keys [synced]} :- [:map {:closed true} [:synced :boolean]]]
  (api/check-superuser)
  (let [collection (synced-collections/set-synced! id synced)]
    (-> (select-keys collection [:id :name :description])
        (assoc :is_remote_synced (boolean (api/bit->boolean (:is_remote_synced collection)))))))
