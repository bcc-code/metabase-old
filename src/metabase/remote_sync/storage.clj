(ns metabase.remote-sync.storage
  "How synced content is laid out in the repository: one YAML file per entity, under directories that mirror the
  Collection tree.

    collections/<entity_id>_<slug>/collection.yaml          a synced Collection
    collections/<entity_id>_<slug>/cards/<entity_id>_<slug>.yaml
    collections/<entity_id>_<slug>/dashboards/...            (also documents/, timelines/, actions/)
    collections/<entity_id>_<slug>/<entity_id>_<slug>/...    a child Collection
    snippets/<entity_id>_<slug>.yaml                         a SQL snippet outside any folder
    snippets/<entity_id>_<slug>/collection.yaml              a snippet folder, its snippets next to it

  Every file holds the entity's portable serialized form, `serdes/meta` included, so reading the content back doesn't
  depend on file names: renaming or moving a file changes nothing. The `collections/` and `snippets/` directories
  belong to Metabase, which rewrites them on every export; anything else in the repository is left alone."
  (:require
   [babashka.fs :as fs]
   [clojure.java.io :as io]
   [clojure.string :as str]
   [metabase.util :as u]
   [metabase.util.i18n :refer [tru]]
   [metabase.util.yaml :as yaml])
  (:import
   (java.io File)
   (java.nio.charset StandardCharsets)
   (java.security MessageDigest)
   (java.time.temporal Temporal)))

(set! *warn-on-reflection* true)

(def collections-dir
  "The directory of the synced Collections and their content."
  "collections")

(def snippets-dir
  "The directory of the SQL snippets and their folders."
  "snippets")

(def managed-dirs
  "The top-level directories Git sync owns, each with a trailing slash."
  [(str collections-dir "/") (str snippets-dir "/")])

(def ^:private collection-file-name "collection.yaml")

(def ^:private model->dir
  "The directory, inside the directory of its Collection, of each kind of entity that lives in a Collection."
  {"Card"      "cards"
   "Dashboard" "dashboards"
   "Document"  "documents"
   "Timeline"  "timelines"
   "Action"    "actions"})

(defn entity-model
  "The serdes model name of `entity`, e.g. `\"Card\"`."
  [entity]
  (-> entity :serdes/meta last :model))

;;; ------------------------------------------------- Writing YAML -------------------------------------------------

(defn- key-string [k]
  (if (keyword? k) (u/qualified-name k) (str k)))

(defn- canonical
  "`x` with keywords turned into strings and map keys sorted, so the same content always renders the same YAML."
  [x]
  (cond
    (map? x)        (into (sorted-map) (map (fn [[k v]] [(key-string k) (canonical v)])) x)
    (keyword? x)    (u/qualified-name x)
    (set? x)        (vec (sort-by str (map canonical x)))
    (sequential? x) (mapv canonical x)
    (instance? Temporal x) x
    :else           x))

(defn entity->yaml
  "The YAML text of the serialized `entity`."
  ^String [entity]
  (yaml/generate-string (canonical entity) :dumper-options {:flow-style :block}))

(defn content-hash
  "The hex SHA-256 of `s`."
  [^String s]
  (let [digest (.digest (MessageDigest/getInstance "SHA-256") (.getBytes s StandardCharsets/UTF_8))]
    (apply str (map #(format "%02x" (bit-and % 0xff)) digest))))

;;; ------------------------------------------------- Reading YAML -------------------------------------------------

(def ^:private keyword-key
  "Map keys that become keywords when read back: identifier-like names such as `name`, `graph.dimensions` or
  `serdes/meta`. Other keys stay strings, notably the JSON-encoded column references that key visualization
  settings and click behavior mappings, which the importers decode from the string."
  #"[\p{L}\p{N}_\-.?!*+]+(?:/[\p{L}\p{N}_\-.?!*+]+)?")

(defn- read-key [k]
  (if (and (string? k) (re-matches keyword-key k))
    (keyword k)
    k))

(defn- from-yaml-data [x]
  (cond
    (map? x)        (into {} (map (fn [[k v]] [(read-key k) (from-yaml-data v)])) x)
    (sequential? x) (mapv from-yaml-data x)
    :else           x))

(defn- valid-meta? [entity]
  (let [entity-meta (:serdes/meta entity)]
    (and (sequential? entity-meta)
         (seq entity-meta)
         (every? #(and (map? %) (string? (:model %)) (some? (:id %))) entity-meta))))

(defn yaml->entity
  "The serialized entity in the YAML text `s` of the file at `path`. Throws when it isn't one."
  [^String s path]
  (let [entity (try
                 (from-yaml-data (yaml/parse-string s :keywords false))
                 (catch Exception e
                   (throw (ex-info (tru "Could not read {0}: {1}" path (ex-message e))
                                   {:status-code 400, :path path}
                                   e))))]
    (when-not (and (map? entity) (valid-meta? entity))
      (throw (ex-info (tru "{0} is not a Metabase entity: it has no valid serdes/meta." path)
                      {:status-code 400, :path path})))
    (update entity :serdes/meta (fn [entity-meta]
                                  (mapv #(update % :id (fn [id] (cond-> id (not (string? id)) str))) entity-meta)))))

;;; ---------------------------------------------------- Paths -----------------------------------------------------

(defn- slug [s]
  (or (not-empty (u/slugify (str s) {:max-length 60 :unicode? true}))
      "unnamed"))

(defn- entry-name [{:keys [entity_id name]}]
  (str entity_id "_" (slug name)))

(defn- root-dir [collection-namespace]
  (if (= "snippets" (some-> collection-namespace u/qualified-name))
    snippets-dir
    collections-dir))

(defn collection-dirs
  "A map of `entity_id` to the directory of each of the serialized `collections`."
  [collections]
  (let [by-entity-id (u/index-by :entity_id collections)
        dir          (fn dir [{:keys [parent_id] :as collection} seen]
                       (let [parent (get by-entity-id parent_id)]
                         (str (if (and parent (not (contains? seen parent_id)))
                                (dir parent (conj seen parent_id))
                                (root-dir (:namespace collection)))
                              "/"
                              (entry-name collection))))]
    (update-vals by-entity-id #(dir % #{(:entity_id %)}))))

(defn entity-path
  "The path, relative to the repository root, of the file of the serialized `entity`, given the directories of the
  Collections from [[collection-dirs]]."
  [entity collection-dirs]
  (let [model (entity-model entity)]
    (case model
      "Collection"         (str (get collection-dirs (:entity_id entity)) "/" collection-file-name)
      "NativeQuerySnippet" (str (get collection-dirs (:collection_id entity) snippets-dir) "/" (entry-name entity) ".yaml")
      (str (get collection-dirs (:collection_id entity) collections-dir)
           "/" (or (model->dir model) (u/lower-case-en model))
           "/" (entry-name entity) ".yaml"))))

;;; ------------------------------------------------ Working tree --------------------------------------------------

(defn clear-managed-dirs!
  "Delete the directories Git sync owns from the working tree at `root`."
  [^File root]
  (doseq [dir [collections-dir snippets-dir]
          :let [f (io/file root dir)]
          :when (.exists f)]
    (fs/delete-tree f)))

(defn write-file!
  "Write `content` to the file at `path`, relative to `root`, creating its directories."
  [^File root path ^String content]
  (let [f (io/file root path)]
    (io/make-parents f)
    (spit f content :encoding "UTF-8")))

(defn read-entities
  "The serialized entities in the YAML files of the directories Git sync owns in the working tree at `root`, each with
  the path of its file at `::path`."
  [^File root]
  (let [root-path (fs/path root)]
    (into []
          (comp (mapcat (fn [dir]
                          (let [d (io/file root dir)]
                            (when (.isDirectory d)
                              (sort (fs/glob d "**.yaml"))))))
                (filter fs/regular-file?)
                (map (fn [p]
                       (let [path (str/replace (str (fs/relativize root-path p)) File/separator "/")]
                         (assoc (yaml->entity (slurp (fs/file p) :encoding "UTF-8") path) ::path path)))))
          [collections-dir snippets-dir])))
