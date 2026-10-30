(ns metabase.remote-sync.changes
  "What changed in the synced content of this instance since it last matched the repository.

  After every export and import, the snapshot records each synced entity with the hash of the file it renders to.
  An entity is changed locally when it renders differently now, created when it isn't in the snapshot, and deleted
  when only the snapshot has it."
  (:require
   [clojure.string :as str]
   [java-time.api :as t]
   [metabase.remote-sync.content :as content]
   [metabase.remote-sync.db :as remote-sync.db]
   [metabase.util :as u]))

(set! *warn-on-reflection* true)

(defn current-content
  "The synced content of this instance rendered to files, each with its local ids (see
  [[metabase.remote-sync.content/render]] and [[metabase.remote-sync.content/with-local-ids]])."
  []
  (-> (content/synced-collection-ids)
      content/extract-entities
      content/render
      content/with-local-ids))

(defn- snapshot-row [now {:keys [model id name collection-id display path hash]}]
  {:model_type          model
   :model_id            id
   :model_name          (some-> name (subs 0 (min 254 (count name))))
   :model_collection_id collection-id
   :model_display       (some-> display (subs 0 (min 50 (count display))))
   :status              "synced"
   :status_changed_at   now
   :file_path           path
   :content_hash        hash})

(defn save-snapshot!
  "Record `rendered`, the content from [[current-content]], as the content this instance last synced."
  [rendered]
  (let [now (t/offset-date-time)]
    (remote-sync.db/replace-snapshot! (into [] (comp (filter :id) (map #(snapshot-row now %))) rendered))))

(defn forget-last-sync!
  "Forget what was last synced, so that all synced content counts as created."
  []
  (remote-sync.db/replace-snapshot! []))

(defn- entity-kind [{:keys [model_type]}]
  (if (= model_type "Card") "card" (u/lower-case-en model_type)))

(defn diff
  "The entities of `rendered` (from [[current-content]]) that differ from `snapshot`, the rows of the last sync, as maps
  of `:id`, `:name`, `:model` (the kind of entity the UI shows), `:collection_id`, `:display` and `:sync_status`
  (`\"create\"`, `\"update\"` or `\"delete\"`)."
  [rendered snapshot]
  (let [snapshot-by-key (into {} (map (juxt (juxt :model_type :model_id) identity)) snapshot)
        current-keys    (into #{} (map (juxt :model :id)) rendered)]
    (vec
     (concat
      (for [{:keys [model id kind display collection-id hash] :as item} rendered
            :when id
            :let  [previous (get snapshot-by-key [model id])
                   status   (cond
                              (nil? previous)                    "create"
                              (not= hash (:content_hash previous)) "update")]
            :when status]
        {:id            id
         :name          (:name item)
         :model         kind
         :collection_id (if (= model "Collection") id collection-id)
         :display       display
         :sync_status   status})
      (for [{:keys [model_type model_id model_name model_collection_id model_display] :as row} snapshot
            :when (not (contains? current-keys [model_type model_id]))]
        {:id            model_id
         :name          model_name
         :model         (entity-kind row)
         :collection_id model_collection_id
         :display       model_display
         :sync_status   "delete"})))))

(defn snapshot
  "The synced entities as this instance last synced them, as rows of `remote_sync_object`."
  []
  (remote-sync.db/snapshot-entities))

(defn local-changes
  "The synced entities that changed locally since this instance last matched the repository (see [[diff]])."
  []
  (diff (current-content) (snapshot)))

(defn changed-collections
  "A map of Collection id to `true` for the Collections holding one of `changes`, directly or further down."
  [changes]
  (let [collection-ids (into #{} (keep :collection_id) changes)]
    (into {}
          (comp (mapcat (fn [{:keys [id location]}]
                          (cons id (keep parse-long (str/split (str location) #"/")))))
                (map (fn [id] [id true])))
          (remote-sync.db/collection-rows collection-ids))))

(defn synced-entity-ids
  "The ids of the `model-type` (a serdes model name such as `\"NativeQuerySnippet\"`) entities this instance last
  synced."
  [model-type]
  (remote-sync.db/snapshot-entity-ids model-type))
