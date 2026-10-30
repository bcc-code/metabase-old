(ns metabase.remote-sync.db
  "Application database queries for the remote sync module. Every function here is a direct Toucan 2 call with no
  additional logic, so no other namespace in the module runs a query itself (hydration definitions still use `toucan2.core`)."
  (:require
   [metabase.lib.schema.id :as lib.schema.id]
   [metabase.util.malli :as mu]
   [metabase.util.malli.registry :as mr]
   [metabase.util.malli.schema :as ms]
   [toucan2.core :as t2])
  (:import
   (java.time.temporal Temporal)))

(set! *warn-on-reflection* true)

(mr/def ::timestamp
  "A point in time, as written to a timestamp column."
  [:fn {:error/message "a java.time timestamp"} #(instance? Temporal %)])

(mr/def ::snapshot-row
  "A synced entity as this instance last synced it: a row of `remote_sync_object`."
  [:map {:closed true}
   [:model_type          :string]
   [:model_id            ms/PositiveInt]
   [:model_name          [:maybe :string]]
   [:model_collection_id [:maybe ms/PositiveInt]]
   [:model_display       [:maybe :string]]
   [:status              :string]
   [:status_changed_at   ::timestamp]
   [:file_path           [:maybe :string]]
   [:content_hash        [:maybe :string]]])

(mr/def ::task-outcome
  "How a Git sync task ended, for the UI to describe."
  [:map {:closed true}
   [:kind   :string]
   [:count  {:optional true} nat-int?]
   [:branch {:optional true} :string]])

(mr/def ::task-changes
  "Columns of a Git sync task to write: a row of `remote_sync_task`."
  [:map {:closed true}
   [:sync_task_type          {:optional true} [:enum :import :export]]
   [:initiated_by            {:optional true} [:maybe ms/PositiveInt]]
   [:started_at              {:optional true} ::timestamp]
   [:ended_at                {:optional true} [:maybe ::timestamp]]
   [:last_progress_report_at {:optional true} ::timestamp]
   [:last_heartbeat_at       {:optional true} [:maybe ::timestamp]]
   [:progress                {:optional true} [:maybe number?]]
   [:cancelled               {:optional true} :boolean]
   [:error_message           {:optional true} [:maybe :string]]
   [:version                 {:optional true} [:maybe :string]]
   [:outcome                 {:optional true} [:maybe ::task-outcome]]
   [:conflicts               {:optional true} [:maybe [:sequential :string]]]])

(mu/defn remote-synced-collection-ids
  "The ids among `collection-ids` of Collections that are remote synced, or nil."
  [collection-ids :- [:set ::lib.schema.id/collection]]
  (t2/select-pks-set :model/Collection :id [:in collection-ids] :is_remote_synced true))

(mu/defn is-remote-synced-by-id
  "The `:id` and the containing Collection's `:is_remote_synced` of the `model` rows with `ids`."
  [model :- :keyword
   ids :- [:sequential ms/PositiveInt]]
  (t2/select [model :id [:c.is_remote_synced :is_remote_synced]]
             {:where [:in (keyword (str (name (t2/table-name model)) ".id")) ids]
              :join  [[:collection :c] [:= :collection_id :c.id]]}))

;;; ------------------------------------------------- Collections --------------------------------------------------

(mu/defn all-remote-synced-collection-ids :- [:maybe [:set ::lib.schema.id/collection]]
  "The ids of every remote-synced Collection."
  []
  (t2/select-pks-set :model/Collection :is_remote_synced true))

(mu/defn collection-ids-in-namespace :- [:maybe [:set ::lib.schema.id/collection]]
  "The ids of every Collection in the Collection namespace `collection-namespace`."
  [collection-namespace :- :string]
  (t2/select-pks-set :model/Collection :namespace [:auto/param collection-namespace]))

(mu/defn collection-sync-info :- [:maybe :map]
  "The `:id`, `:is_remote_synced` and `:namespace` of the Collection with `collection-id`, or nil."
  [collection-id :- ::lib.schema.id/collection]
  (t2/select-one [:model/Collection :id :is_remote_synced :namespace] :id [:auto/param collection-id]))

(mu/defn collection :- [:maybe :map]
  "The Collection with `collection-id`, or nil."
  [collection-id :- ::lib.schema.id/collection]
  (t2/select-one :model/Collection :id [:auto/param collection-id]))

(mu/defn top-level-regular-collections :- [:maybe [:sequential :map]]
  "The `:id`, `:name`, `:description`, `:entity_id` and `:is_remote_synced` of the unarchived Collections at the top
  of the default Collection namespace that are neither personal nor special-purpose, by name."
  []
  (t2/select [:model/Collection :id :name :description :entity_id :is_remote_synced]
             {:where    [:and
                         [:= :location "/"]
                         [:= :namespace nil]
                         [:= :personal_owner_id nil]
                         [:= :type nil]
                         [:= :archived false]]
              :order-by [[[:lower :name] :asc] [:id :asc]]}))

(mu/defn set-collection-remote-synced!
  "Set `:is_remote_synced` of the Collection with `collection-id` to `synced?`, running the Collection update hooks.
  Returns the number of rows updated."
  [collection-id :- ::lib.schema.id/collection
   synced?       :- :boolean]
  (t2/update! :model/Collection collection-id {:is_remote_synced synced?}))

(mu/defn set-descendant-collections-remote-synced!
  "Set `:is_remote_synced` of every Collection under `children-location` to `synced?`, returning the number updated."
  [children-location :- :string
   synced?           :- :boolean]
  (t2/query-one {:update :collection
                 :set    {:is_remote_synced synced?}
                 :where  [:like :location [:auto/param (str children-location "%")]]}))

(mu/defn collection-rows :- [:maybe [:sequential :map]]
  "The `:id`, `:entity_id`, `:location`, `:name` and `:namespace` of the Collections with `collection-ids`."
  [collection-ids :- [:set ::lib.schema.id/collection]]
  (when (seq collection-ids)
    (t2/select [:model/Collection :id :entity_id :location :name :namespace] :id [:in collection-ids])))

;;; --------------------------------------------- Synced entities ---------------------------------------------------

(mu/defn ids-by-entity-id :- [:maybe [:map-of :string ms/PositiveInt]]
  "A map of `entity_id` to `id` of the `model` rows with one of `entity-ids`."
  [model      :- :keyword
   entity-ids :- [:sequential :string]]
  (if (seq entity-ids)
    (t2/select-fn->fn :entity_id :id [model :id :entity_id] :entity_id [:in entity-ids])
    {}))

(mu/defn entity-rows-in-collections :- [:maybe [:sequential :map]]
  "The `:id` and `:entity_id` of the `model` rows in one of the Collections with `collection-ids`."
  [model          :- :keyword
   collection-ids :- [:set ::lib.schema.id/collection]]
  (if (seq collection-ids)
    (t2/select [model :id :entity_id] :collection_id [:in collection-ids])
    []))

(mu/defn rows-with-entity-ids :- [:maybe [:sequential :map]]
  "The `model` rows with one of `entity-ids`."
  [model      :- :keyword
   entity-ids :- [:sequential :string]]
  (if (seq entity-ids)
    (t2/select model :entity_id [:in entity-ids])
    []))

(mu/defn collections-with-entity-ids :- [:maybe [:sequential :map]]
  "The `:id`, `:entity_id` and `:location` of the Collections with one of `entity-ids`."
  [entity-ids :- [:sequential :string]]
  (if (seq entity-ids)
    (t2/select [:model/Collection :id :entity_id :location] :entity_id [:in entity-ids])
    []))

(mu/defn entity-names :- [:maybe [:map-of ms/PositiveInt [:maybe :string]]]
  "A map of id to name of the `model` rows with `ids`."
  [model :- :keyword
   ids   :- [:sequential ms/PositiveInt]]
  (if (seq ids)
    (t2/select-fn->fn :id :name [model :id :name] :id [:in ids])
    {}))

(mu/defn delete-entities!
  "Delete the `model` rows with `ids`, running the model's delete hooks. Returns the number deleted."
  [model :- :keyword
   ids   :- [:sequential ms/PositiveInt]]
  (if (seq ids)
    (t2/delete! model :id [:in ids])
    0))

;;; ------------------------------------------------- Snapshot ------------------------------------------------------

(mu/defn snapshot-entities :- [:maybe [:sequential :map]]
  "Every synced entity as this instance last synced it."
  []
  (t2/select :model/GitSyncEntity))

(mu/defn snapshot-entity-ids :- [:maybe [:set ms/PositiveInt]]
  "The ids of the `model-type` entities of the last sync, `model-type` being a serdes model name."
  [model-type :- :string]
  (t2/select-fn-set :model_id :model/GitSyncEntity :model_type [:auto/param model-type]))

(mu/defn replace-snapshot!
  "Replace the synced entities of the last sync with `rows`."
  [rows :- [:sequential ::snapshot-row]]
  (t2/delete! :model/GitSyncEntity)
  (doseq [batch (partition-all 500 rows)]
    (t2/insert! :model/GitSyncEntity batch)))

;;; --------------------------------------------------- Tasks -------------------------------------------------------

(mu/defn unfinished-tasks :- [:maybe [:sequential :map]]
  "The Git sync tasks that haven't ended, oldest first."
  []
  (t2/select :model/GitSyncTask {:where    [:= :ended_at nil]
                                 :order-by [[:id :asc]]}))

(mu/defn insert-task! :- :map
  "Insert a Git sync task from `row` and return it."
  [row :- ::task-changes]
  (t2/insert-returning-instance! :model/GitSyncTask row))

(mu/defn update-task!
  "Apply `changes` to the Git sync task with `task-id`, returning the number updated."
  [task-id :- ms/PositiveInt
   changes :- ::task-changes]
  (t2/update! :model/GitSyncTask task-id changes))

(mu/defn task :- [:maybe :map]
  "The Git sync task with `task-id`, or nil."
  [task-id :- ms/PositiveInt]
  (t2/select-one :model/GitSyncTask :id [:auto/param task-id]))

(mu/defn latest-task :- [:maybe :map]
  "The most recently started Git sync task, or nil."
  []
  (t2/select-one :model/GitSyncTask {:order-by [[:id :desc]]}))

(mu/defn latest-successful-task :- [:maybe :map]
  "The most recently started Git sync task of `task-type` that ended without an error, or nil."
  [task-type :- :keyword]
  (t2/select-one :model/GitSyncTask {:where    [:and
                                                [:= :sync_task_type [:auto/param (name task-type)]]
                                                [:not= :ended_at nil]
                                                [:= :error_message nil]
                                                [:= :cancelled false]]
                                     :order-by [[:id :desc]]}))

(mu/defn finished-task-ids :- [:maybe [:sequential ms/PositiveInt]]
  "The ids of the ended Git sync tasks, newest first."
  []
  (t2/select-pks-vec :model/GitSyncTask {:where    [:not= :ended_at nil]
                                         :order-by [[:id :desc]]}))

(mu/defn delete-tasks!
  "Delete the Git sync tasks with `task-ids`, returning the number deleted."
  [task-ids :- [:sequential ms/PositiveInt]]
  (if (seq task-ids)
    (t2/delete! :model/GitSyncTask :id [:in task-ids])
    0))

(mu/defn users-by-id :- [:maybe [:map-of ms/PositiveInt :map]]
  "A map of id to the `:id`, `:first_name`, `:last_name` and `:email` of the Users with `user-ids`."
  [user-ids :- [:set ms/PositiveInt]]
  (if (seq user-ids)
    (t2/select-pk->fn identity [:model/User :id :first_name :last_name :email] :id [:in user-ids])
    {}))
