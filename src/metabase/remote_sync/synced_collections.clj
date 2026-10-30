(ns metabase.remote-sync.synced-collections
  "Choosing which Collections Git sync syncs. An admin marks a top-level Collection, and everything under it is synced
  with it."
  (:require
   [clojure.string :as str]
   [metabase.collections.core :as collections]
   [metabase.remote-sync.core :as remote-sync]
   [metabase.remote-sync.db :as remote-sync.db]
   [metabase.util.i18n :refer [tru]]
   [toucan2.core :as t2]))

(set! *warn-on-reflection* true)

(def ^:private max-listed
  "How many offending entities an error message names."
  10)

(def ^:private named-models
  #{"Action" "Card" "Collection" "Dashboard" "Document" "NativeQuerySnippet" "Timeline"})

(defn- describe-entities
  "A comma-separated list naming the entities in `model+ids` (pairs of serdes model name and id) that have a name."
  [model+ids]
  (let [named (for [[model ids] (group-by first (filter (comp named-models first) model+ids))
                    :let [names (remote-sync.db/entity-names (keyword "model" model) (mapv second ids))]
                    [_ id] ids]
                (str model " \"" (get names id id) "\""))]
    (cond-> (str/join ", " (take max-listed named))
      (> (count named) max-listed) (str ", …"))))

(defn- check-dependencies-synced!
  "Throws a 400 naming the content outside synced Collections that `collection`, now marked as synced, uses."
  [collection]
  (when-let [deps (seq (collections/ineligible-dependencies collection))]
    (throw (ex-info (tru "This collection uses content that isn''t in a synced collection: {0}. Move it into a synced collection, or sync the collection it is in, first."
                         (describe-entities (map (juxt :model :id) deps)))
                    {:status-code 400}))))

(defn- check-no-synced-dependents!
  "Throws a 400 naming the synced content that uses what's in `collection`, now no longer synced."
  [collection]
  (when-let [dependents (seq (collections/remote-synced-dependents collection))]
    (throw (ex-info (tru "Content in other synced collections uses this collection''s content: {0}."
                         (describe-entities (mapcat seq dependents)))
                    {:status-code 400}))))

(defn set-synced!
  "Mark the top-level Collection with `collection-id`, and everything under it, as synced (`synced?` true) or not.
  Throws a 400 when it can't be synced, or when that would leave synced content using content that isn't synced.
  Returns the Collection."
  [collection-id synced?]
  (let [collection (or (remote-sync.db/collection collection-id)
                       (throw (ex-info (tru "Collection not found.") {:status-code 404})))]
    (when (remote-sync/read-only?)
      (throw (ex-info (tru "This instance only imports from Git, so the collections it syncs come from the repository.")
                      {:status-code 400})))
    (when-not (= "/" (:location collection))
      (throw (ex-info (tru "Only top-level collections can be synced. A collection inside a synced collection is synced along with it.")
                      {:status-code 400})))
    (when (and synced? (not (remote-sync/collection-syncable? collection)))
      (throw (ex-info (tru "This collection can''t be synced.") {:status-code 400})))
    (t2/with-transaction [_conn]
      (remote-sync.db/set-collection-remote-synced! collection-id (boolean synced?))
      (remote-sync.db/set-descendant-collections-remote-synced! (str "/" collection-id "/") (boolean synced?))
      (let [updated (remote-sync.db/collection collection-id)]
        (if synced?
          (check-dependencies-synced! updated)
          (check-no-synced-dependents! updated))
        updated))))

(defn top-level-collections
  "The top-level Collections that can be synced, with whether they are, by name."
  []
  (remote-sync.db/top-level-regular-collections))
