(ns metabase.remote-sync.content
  "The synced content of this instance, as serialized entities: extracting it, rendering it to files, and loading
  serialized entities back in dependency order, removing what the repository no longer has.

  Synced content is every remote-synced Collection with what's in it (questions, models and metrics, dashboards with
  their tabs and cards, documents, timelines with their events, actions), plus the SQL snippets it uses and the
  snippet folders those are in. References to databases, tables and fields are portable (by name), as are users (by
  email)."
  (:require
   [clojure.string :as str]
   [metabase.models.serialization :as serdes]
   [metabase.remote-sync.db :as remote-sync.db]
   [metabase.remote-sync.storage :as storage]
   [metabase.util :as u]
   [metabase.util.i18n :refer [tru]]
   [metabase.util.log :as log]
   [toucan2.core :as t2]))

(set! *warn-on-reflection* true)

(def synced-models
  "The serdes model names of the synced entities, in extraction order."
  ["Collection" "NativeQuerySnippet" "Card" "Dashboard" "Document" "Timeline" "Action"])

(def ^:private nested-models
  "Models whose rows are serialized inside the file of their parent."
  ["DashboardTab" "DashboardCard" "DashboardCardSeries" "TimelineEvent" "QueryAction" "ImplicitAction"])

(defn model-key
  "The Toucan model of the serdes model name `model-name`."
  [model-name]
  (keyword "model" model-name))

(defn- ensure-models-loaded!
  "Load the namespaces defining the serialization methods of the synced models."
  []
  (doseq [model-name (concat synced-models nested-models)]
    (t2/resolve-model (model-key model-name))))

;;; ------------------------------------------------- Extraction ---------------------------------------------------

(defn synced-collection-ids
  "The ids of the Collections whose content is synced right now."
  []
  (or (remote-sync.db/all-remote-synced-collection-ids) #{}))

(defn- extract-collection-content
  "The serialized remote-synced Collections with `collection-ids` and what's in them."
  [collection-ids]
  (when (seq collection-ids)
    (into []
          (mapcat (fn [model-name]
                    (into [] (serdes/extract-all model-name {:collection-set (set collection-ids)}))))
          ["Collection" "Card" "Dashboard" "Document" "Timeline" "Action"])))

(defn- referenced-entity-ids
  "The entity ids of the `model-name` entities that the serialized `entities` depend on."
  [model-name entities]
  (into #{}
        (comp (mapcat serdes/deserialization-dependencies)
              (keep (fn [path]
                      (let [{:keys [model id]} (last path)]
                        (when (and (= model model-name) (string? id))
                          id)))))
        entities))

(defn- extract-snippets
  "The serialized SQL snippets that the serialized `entities` use, directly or through other snippets."
  [entities]
  (loop [extracted {}
         wanted    (referenced-entity-ids "NativeQuerySnippet" entities)]
    (let [new-ids (remove #(contains? extracted %) wanted)]
      (if (empty? new-ids)
        (vec (vals extracted))
        (let [snippets  (into []
                              (comp (mapcat #(remote-sync.db/rows-with-entity-ids (model-key "NativeQuerySnippet") (vec %)))
                                    (map #(serdes/log-and-extract-one "NativeQuerySnippet" {} %)))
                              (partition-all serdes/query-batch-size new-ids))
              extracted (into (reduce #(assoc %1 %2 nil) extracted new-ids)
                              (map (juxt :entity_id identity))
                              snippets)]
          (recur extracted (referenced-entity-ids "NativeQuerySnippet" snippets)))))))

(defn- location-ids
  "The ids of the ancestors in the Collection `location` path, e.g. `\"/1/2/\"`."
  [location]
  (into [] (keep parse-long) (str/split (str location) #"/")))

(defn- extract-snippet-folders
  "The serialized snippet folders that hold the serialized `snippets`, with their ancestors."
  [snippets]
  (let [folder-ids (into #{}
                         (mapcat (fn [{:keys [id location]}]
                                   (cons id (location-ids location))))
                         (remote-sync.db/collections-with-entity-ids (vec (into #{} (keep :collection_id) snippets))))]
    (when (seq folder-ids)
      (into [] (serdes/extract-all "Collection" {:collection-set folder-ids})))))

(defn extract-entities
  "The serialized synced content: the remote-synced Collections with `collection-ids` and what's in them, and the SQL
  snippets they use with the folders those are in."
  [collection-ids]
  (ensure-models-loaded!)
  (serdes/with-cache
    (let [content  (extract-collection-content collection-ids)
          snippets (filterv some? (extract-snippets content))]
      (-> (vec (extract-snippet-folders snippets))
          (into snippets)
          (into content)))))

(defn- card-kind
  "The kind of entity the UI shows for a serialized entity."
  [entity]
  (if (= "Card" (storage/entity-model entity))
    (case (some-> (:type entity) u/qualified-name)
      "model"  "dataset"
      "metric" "metric"
      "card")
    (u/lower-case-en (storage/entity-model entity))))

(defn render
  "Each of the serialized `entities` with the file it is written to: a map of its `:model`, `:entity-id`, `:name`,
  `:kind`, `:display`, `:collection-entity-id`, the `:path` and `:yaml` text of its file and the `:hash` of that text."
  [entities]
  (let [dirs (storage/collection-dirs (filter #(= "Collection" (storage/entity-model %)) entities))]
    (vec (for [entity entities
               :let   [yaml-text (storage/entity->yaml entity)
                       model     (storage/entity-model entity)]]
           {:model                model
            :entity-id            (:entity_id entity)
            :name                 (:name entity)
            :kind                 (card-kind entity)
            :display              (some-> (:display entity) u/qualified-name)
            :collection-entity-id (if (= model "Collection") (:parent_id entity) (:collection_id entity))
            :path                 (storage/entity-path entity dirs)
            :yaml                 yaml-text
            :hash                 (storage/content-hash yaml-text)}))))

(defn with-local-ids
  "The `rendered` entities (from [[render]]) with the `:id` of the local row of each, and the `:collection-id` of its
  local Collection."
  [rendered]
  (let [model->ids  (into {}
                          (for [[model items] (group-by :model rendered)]
                            [model (into {}
                                         (mapcat #(remote-sync.db/ids-by-entity-id (model-key model) (vec %)))
                                         (partition-all serdes/query-batch-size (map :entity-id items)))]))
        coll-eid->id (get model->ids "Collection" {})]
    (mapv (fn [{:keys [model entity-id collection-entity-id] :as item}]
            (assoc item
                   :id            (get-in model->ids [model entity-id])
                   :collection-id (get coll-eid->id collection-entity-id)))
          rendered)))

;;; --------------------------------------------------- Loading ----------------------------------------------------

(defn- path-key
  "`path` without its labels, to compare paths by."
  [path]
  (mapv (juxt :model :id) path))

(defn entity-label
  "A human-readable name for a serialized entity, for messages."
  [entity]
  (let [{:keys [model id]} (last (serdes/path entity))]
    (if-let [entity-name (:name entity)]
      (str model " \"" entity-name "\" (" id ")")
      (str model " " id))))

(def ^:private strippable-keys
  "Keys whose references [[load-entities!]] may leave out of the first load of an entity in a dependency cycle: nested
  entities, which loading without them leaves as they are, and nullable references."
  #{:dashcards :tabs :events :dashboard_id :document_id})

(def ^:private neutral-values
  "Keys whose references [[load-entities!]] may replace with an empty value in the first load of an entity in a
  dependency cycle."
  {:visualization_settings {}
   :parameters             []
   :parameter_mappings     []})

(def ^:private dependency-context-keys
  "Keys some models read to work out the dependencies of other keys."
  [:serdes/meta :content_type :type])

(defn- keys-referencing
  "The keys of `entity` whose values reference one of the paths in `dep-keys`."
  [entity dep-keys]
  (let [context (select-keys entity dependency-context-keys)]
    (into #{}
          (filter (fn [k]
                    (some #(contains? dep-keys (path-key %))
                          (serdes/deserialization-dependencies (assoc context k (get entity k))))))
          (remove (set dependency-context-keys) (keys entity)))))

(defn- without-references
  "`entity` with the keys that reference `dep-keys` left out or emptied, so it can be loaded before them. Throws when a
  key can't be left out."
  [entity dep-keys]
  (let [ks (keys-referencing entity dep-keys)]
    (when-let [blocking (seq (remove #(or (strippable-keys %) (contains? neutral-values %)) ks))]
      (throw (ex-info (tru "Cannot import {0}: its {1} form a circular dependency."
                           (entity-label entity) (pr-str (vec blocking)))
                      {:status-code 400})))
    (let [strip (set (filter strippable-keys ks))]
      (cond-> (merge entity (select-keys neutral-values ks))
        (seq strip) (assoc ::serdes/strip strip)))))

(defn- load-entity!
  [entity]
  (try
    (serdes/load-one! entity (serdes/load-find-local (serdes/path entity)))
    (catch Exception e
      (throw (ex-info (tru "Failed to import {0} from {1}: {2}"
                           (entity-label entity) (::storage/path entity "?") (ex-message e))
                      {:status-code 400}
                      e)))))

(def ^:private load-order
  "The models loaded first come first, so that in a dependency cycle between a container and what it contains (a
  dashboard and its dashboard questions, a document and its cards) the content is the one loaded without the
  reference."
  {"Collection" 0, "NativeQuerySnippet" 1, "Dashboard" 2, "Document" 3, "Timeline" 4, "Card" 5, "Action" 6})

(defn load-entities!
  "Load the serialized `entities` into the app DB, each after the entities it depends on. An entity in a dependency
  cycle is loaded first without the references that close the cycle, then again in full once the rest is loaded.
  Calls `progress!` with the fraction loaded so far."
  [entities progress!]
  (ensure-models-loaded!)
  (let [by-key  (into {} (map (juxt (comp path-key serdes/path) identity)) entities)
        total   (max 1 (count by-key))
        deps-of (fn [k]
                  (into []
                        (comp (map path-key)
                              (filter by-key)
                              (remove #{k}))
                        (serdes/deserialization-dependencies (by-key k))))
        state   (volatile! {:loaded #{}, :in-progress #{}, :deferred []})
        loaded? #(contains? (:loaded @state) %)]
    (letfn [(load-key! [k]
              (when-not (or (loaded? k) (contains? (:in-progress @state) k))
                (vswap! state update :in-progress conj k)
                (let [cyclic (reduce (fn [acc dep]
                                       (cond
                                         (loaded? dep)                            acc
                                         (contains? (:in-progress @state) dep)    (conj acc dep)
                                         :else                                    (do (load-key! dep) acc)))
                                     #{}
                                     (deps-of k))
                      entity (by-key k)]
                  (if (seq cyclic)
                    (do (log/debugf "Git sync: loading %s before %s, which it depends on" (entity-label entity) cyclic)
                        (load-entity! (without-references entity cyclic))
                        (vswap! state update :deferred conj k))
                    (load-entity! entity))
                  (vswap! state #(-> %
                                     (update :in-progress disj k)
                                     (update :loaded conj k)))
                  (progress! (/ (count (:loaded @state)) total)))))]
      (serdes/with-cache
        (doseq [k (sort-by (fn [k] [(load-order (ffirst k) 99) (str (second (first k)))]) (keys by-key))]
          (load-key! k))
        (serdes/reset-import-cache!)
        (doseq [k (:deferred @state)]
          (load-entity! (by-key k)))))))

;;; -------------------------------------------------- Deletion ----------------------------------------------------

(defn- entity-ids-by-model [entities]
  (update-vals (group-by storage/entity-model entities)
               #(into #{} (map :entity_id) %)))

(defn delete-missing!
  "Delete the synced entities of this instance that aren't among the serialized `entities`: the content of the
  remote-synced Collections, then the Collections themselves from the deepest up. SQL snippets stay, since content
  that isn't synced may use them. Returns the number of entities deleted per model."
  [entities]
  (let [in-repo        (entity-ids-by-model entities)
        collection-ids (synced-collection-ids)
        delete!        (fn [model rows]
                         (let [ids (into [] (comp (remove #(contains? (get in-repo model #{}) (:entity_id %)))
                                                  (map :id))
                                         rows)]
                           (when (seq ids)
                             (log/infof "Git sync: deleting %d %s missing from the repository" (count ids) model)
                             (remote-sync.db/delete-entities! (model-key model) ids))
                           [model (count ids)]))
        content        (doall
                        (for [model ["Dashboard" "Document" "Timeline" "Action" "Card"]]
                          (delete! model (remote-sync.db/entity-rows-in-collections (model-key model) collection-ids))))
        collections    (->> (remote-sync.db/collection-rows collection-ids)
                            (remove #(contains? (get in-repo "Collection" #{}) (:entity_id %)))
                            (sort-by #(- (count (:location %)))))]
    (doseq [{:keys [id]} collections]
      ;; deleting a Collection deletes its descendants, which may come later in this list
      (remote-sync.db/delete-entities! :model/Collection [id]))
    (when (seq collections)
      (log/infof "Git sync: deleted %d Collections missing from the repository" (count collections)))
    (into {"Collection" (count collections)} content)))
