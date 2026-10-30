(ns metabase.remote-sync.core
  "Git sync: keeping the content of chosen Collections in a Git repository.

  The rules other modules consult live here: which Collections can be synced, and which content can't be edited on a
  read-only instance, one that only imports from the repository."
  (:require
   [metabase.api.common :as api]
   [metabase.premium-features.core :refer [defenterprise]]
   [metabase.remote-sync.db :as remote-sync.db]
   [metabase.remote-sync.settings :as remote-sync.settings]
   [metabase.util :as u]))

(set! *warn-on-reflection* true)

(def ^:private unsyncable-collection-types
  "Collection types that hold content Metabase manages itself, which is never synced."
  #{"trash" "instance-analytics"})

(defn- synced-collection-info
  "The `:id`, `:is_remote_synced` and `:namespace` of `collection` (a Collection, its id, or nil for the root
  Collection), reading them from the app DB when `collection` doesn't have them."
  [collection]
  (cond
    (integer? collection)
    (remote-sync.db/collection-sync-info collection)

    (and (map? collection) (contains? collection :is_remote_synced))
    collection

    (and (map? collection) (pos-int? (:id collection)))
    (remote-sync.db/collection-sync-info (:id collection))))

(defn- snippet-namespace? [collection-namespace]
  (= "snippets" (some-> collection-namespace u/qualified-name)))

(defn- synced-collection?
  "Whether the Collection described by `info` (from [[synced-collection-info]]) is synced: a remote-synced Collection,
  or a snippet folder the last sync exported or imported."
  [{:keys [id is_remote_synced] collection-namespace :namespace}]
  (or (api/bit->boolean is_remote_synced)
      (boolean (and id
                    (snippet-namespace? collection-namespace)
                    (contains? (remote-sync.db/snapshot-entity-ids "Collection") id)))))

(defenterprise collection-editable?
  "Whether the content of `collection` (a Collection, its id, or nil for the root Collection) can be edited: false for a
  synced Collection when this instance is read-only."
  metabase-enterprise.remote-sync.core
  [collection]
  (or (not (remote-sync.settings/read-only?))
      (not (some-> collection synced-collection-info synced-collection?))))

(defenterprise table-editable?
  "Whether a table's metadata can be edited. Git sync doesn't sync table metadata, so always true."
  metabase-enterprise.remote-sync.core
  [_table]
  true)

(defenterprise transforms-editable?
  "Whether transforms can be edited. Git sync doesn't sync transforms, so always true."
  metabase-enterprise.remote-sync.core
  []
  true)

(defn- synced-snippet-ids []
  (remote-sync.db/snapshot-entity-ids "NativeQuerySnippet"))

(defenterprise model-editable?
  "Whether `instance` of `model-key` can be edited: false for synced content when this instance is read-only. Synced
  content is what's in a synced Collection, and the SQL snippets the last sync exported or imported. Models Git sync
  doesn't sync are always editable, and so is a nil `instance`."
  metabase-enterprise.remote-sync.core
  [model-key instance]
  (or (not (remote-sync.settings/read-only?))
      (nil? instance)
      (case model-key
        :model/Collection         (collection-editable? instance)
        :model/NativeQuerySnippet (not (contains? (synced-snippet-ids) (:id instance)))
        (if (contains? instance :collection_id)
          (collection-editable? (:collection_id instance))
          true))))

(defenterprise batch-model-editable?
  "Batch version of [[model-editable?]]: a map of instance id to whether it can be edited."
  metabase-enterprise.remote-sync.core
  [model-key instances]
  (if-not (remote-sync.settings/read-only?)
    (into {} (map (fn [inst] [(:id inst) true])) instances)
    (case model-key
      :model/NativeQuerySnippet
      (let [synced (synced-snippet-ids)]
        (into {} (map (fn [inst] [(:id inst) (not (contains? synced (:id inst)))])) instances))

      (let [collection-ids (into #{} (keep :collection_id) instances)
            synced         (if (seq collection-ids)
                             (or (remote-sync.db/remote-synced-collection-ids collection-ids) #{})
                             #{})]
        (into {}
              (map (fn [inst]
                     [(:id inst)
                      (if (= model-key :model/Collection)
                        (collection-editable? inst)
                        (not (contains? synced (:collection_id inst))))]))
              instances)))))

(defenterprise batch-model-eligible?
  "Batch check whether model instances can be synced, as a map of instance id to boolean.

  A Collection is eligible when it is remote-synced; a SQL snippet always is, since synced content takes the snippets
  it uses along; anything else when it is in a remote-synced Collection."
  metabase-enterprise.remote-sync.core
  [model-key instances]
  (case model-key
    :model/Collection
    (into {}
          (map (fn [inst]
                 [(:id inst) (boolean (:is_remote_synced inst))]))
          instances)

    :model/NativeQuerySnippet
    (into {} (map (fn [inst] [(:id inst) true])) instances)

    (let [collection-ids (into #{} (keep :collection_id) instances)
          remote-synced-coll-ids (when (seq collection-ids)
                                   (remote-sync.db/remote-synced-collection-ids collection-ids))]
      (into {}
            (map (fn [inst]
                   [(:id inst)
                    (boolean (contains? remote-synced-coll-ids (:collection_id inst)))]))
            instances))))

(defenterprise collection-syncable?
  "Whether `collection` can be remote-synced: a Collection of the default namespace that isn't personal and doesn't
  hold content Metabase manages itself."
  metabase-enterprise.remote-sync.core
  [{collection-namespace :namespace, :keys [personal_owner_id type]}]
  (and (nil? (not-empty (some-> collection-namespace u/qualified-name)))
       (nil? personal_owner_id)
       (not (contains? unsyncable-collection-types (some-> type u/qualified-name)))))

(defn read-only?
  "Whether a repository is connected and this instance only imports from it, keeping synced content from being edited."
  []
  (remote-sync.settings/read-only?))
