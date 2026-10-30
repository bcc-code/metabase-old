(ns metabase.cache.strategies
  "Which cache strategy applies when a Card's query runs.

  With granular cache controls, the most specific CacheConfig wins: the Card's own, then its Dashboard's when the Card
  runs on one, then its Database's, then the root (instance-wide) one. Without them, only a root `:ttl` config counts.
  No config at all means the results aren't cached."
  (:require
   [metabase.cache.db :as cache.db]
   [metabase.cache.models.cache-config :as cache-config]
   [metabase.premium-features.core :as premium-features]))

(defn- config-targets
  "The `[model model-id]` pairs of the CacheConfigs that may decide how `card`'s results are cached when it runs on the
  Dashboard with `dashboard-id` (nil when it doesn't), most specific first."
  [{card-id :id, database-id :database_id} dashboard-id]
  (cond-> []
    card-id      (conj ["question" card-id])
    dashboard-id (conj ["dashboard" dashboard-id])
    database-id  (conj ["database" database-id])
    true         (conj ["root" 0])))

(defn- most-specific-config
  "The CacheConfig that decides how `card`'s results are cached when it runs on the Dashboard with `dashboard-id`, or
  nil when there is none."
  [card dashboard-id]
  (let [targets (config-targets card dashboard-id)
        configs (into {}
                      (map (juxt (juxt :model :model_id) identity))
                      (cache.db/cache-configs-for-targets targets))]
    (some configs targets)))

(defn effective-strategy
  "The cache strategy for `card`'s results when it runs on the Dashboard with `dashboard-id` (nil when it doesn't), with
  the `:invalidated-at` before which cached results are stale. Nil when its results aren't cached."
  [card dashboard-id]
  (cache-config/card-strategy (if (premium-features/enable-cache-granular-controls?)
                                (most-specific-config card dashboard-id)
                                (cache-config/root-strategy))
                              card))
