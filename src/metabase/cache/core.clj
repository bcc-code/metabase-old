(ns metabase.cache.core
  (:require
   [metabase.cache.models.cache-config]
   [metabase.cache.settings]
   [metabase.cache.strategies]
   [potemkin :as p]))

(comment metabase.cache.models.cache-config/keep-me
         metabase.cache.settings/keep-me
         metabase.cache.strategies/keep-me)

(p/import-def metabase.cache.models.cache-config/invalidate! invalidate-config!)

(p/import-vars
 [metabase.cache.models.cache-config
  card-strategy
  root-strategy]
 [metabase.cache.settings
  enable-query-caching
  query-caching-early-refresh-ratio
  query-caching-max-kb
  query-caching-max-ttl]
 [metabase.cache.strategies
  effective-strategy])
