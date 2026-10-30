(ns metabase.cache.refresh.api
  "`/api/cache-refresh/` endpoints, for running automatic cache refreshing from a scheduler outside Metabase."
  (:require
   [buddy.core.hash :as buddy-hash]
   [metabase.api.common :as api]
   [metabase.api.macros :as api.macros]
   [metabase.cache.refresh.core :as cache.refresh]
   [metabase.cache.refresh.settings :as refresh.settings]
   [metabase.util :as u]
   [metabase.util.log :as log])
  (:import
   (java.security MessageDigest)))

(set! *warn-on-reflection* true)

(def ^:private secret-header
  "The request header carrying the [[refresh.settings/cache-refresh-trigger-secret]], in the lower case Ring uses."
  "x-metabase-cache-refresh-secret")

(defn- configured-secret
  "The secret requests must send, or nil when the endpoint is disabled because none, or too short a one, is set."
  []
  (let [secret (refresh.settings/cache-refresh-trigger-secret)]
    (cond
      (nil? secret)
      nil

      (< (count secret) refresh.settings/min-trigger-secret-length)
      (log/warnf "MB_CACHE_REFRESH_TRIGGER_SECRET is shorter than %d characters, so the cache refresh endpoint is disabled"
                 refresh.settings/min-trigger-secret-length)

      :else
      secret)))

(defn- secret-matches?
  "Whether `sent` is `secret`, compared in constant time."
  [secret sent]
  (boolean (and (string? sent)
                (MessageDigest/isEqual ^bytes (buddy-hash/sha256 ^String secret)
                                       ^bytes (buddy-hash/sha256 ^String sent)))))

(api.macros/defendpoint :post "/run" :- [:map
                                         [:policies_refreshed :int]
                                         [:queries_refreshed  :int]
                                         [:queries_failed     :int]
                                         [:duration_ms        :int]]
  "Refresh the cached results of the questions and dashboards whose caching policy refreshes them automatically and
  that are due, and record the runs of cache invalidation schedules: what a task does every minute. Returns once the
  refresh is done, so that it runs while a request is in progress, for hosts that give background work no CPU between
  requests (such as Cloud Run with request-based billing). Call it every minute from a scheduler such as Google Cloud
  Scheduler.

  Not authenticated by a session: requests send the secret set in `MB_CACHE_REFRESH_TRIGGER_SECRET` in the
  `X-Metabase-Cache-Refresh-Secret` header. Responds 404 when that isn't set."
  [_route-params
   _query-params
   _body
   request]
  (let [secret (configured-secret)]
    (api/check-404 secret)
    (api/check-403 (secret-matches? secret (get-in request [:headers secret-header])))
    (let [timer  (u/start-timer)
          totals (cache.refresh/refresh-due-caches!)]
      (u/prog1 (assoc totals :duration_ms (long (u/since-ms timer)))
        (log/infof "Cache refresh run from outside Metabase: %s" (pr-str <>))))))
