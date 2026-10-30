(ns metabase.cache.refresh.core
  "Automatic cache refreshing (\"Refresh cache automatically\" in a question's or dashboard's caching policy).

  When a question's or dashboard's `:duration` or `:schedule` CacheConfig has `refresh_automatically` set, its queries
  are run again as soon as the policy makes their cached results stale, so that people are served from the cache
  instead of waiting for the query: a `:schedule` policy's right after its schedule fires, a `:duration` policy's
  shortly before they expire, and either right after its cache is cleared.

  What runs again is what people ran: for each question, the parameter values they applied to it most often during
  the last caching period, up to [[max-parameter-combinations]] combinations of them, or, when nobody ran it during
  that period, the values they applied when they last did. Questions on a Database with row and column security or
  connection impersonation are left out: their results differ from person to person, so there is no one result to
  keep warm.

  [[refresh-due-caches!]] does a pass over the policies, which a task runs every minute
  ([[metabase.cache.refresh.task]]). Each policy is claimed under a cluster lock before it is refreshed, so that with
  several instances sharing the app DB only one of them refreshes it."
  (:require
   [buddy.core.codecs :as codecs]
   [java-time.api :as t]
   [medley.core :as m]
   [metabase.app-db.cluster-lock :as cluster-lock]
   [metabase.cache.core :as cache]
   [metabase.cache.db :as cache.db]
   [metabase.cache.models.cache-config :as cache-config]
   [metabase.cache.refresh.db :as refresh.db]
   [metabase.cache.schedule :as cache.schedule]
   [metabase.cache.strategies :as cache.strategies]
   [metabase.cache.task.schedule-invalidation :as schedule-invalidation]
   [metabase.data-access.core :as data-access]
   [metabase.lib.core :as lib]
   [metabase.lib.schema.constraints :as lib.schema.constraints]
   [metabase.lib.schema.parameter :as lib.schema.parameter]
   [metabase.premium-features.core :as premium-features]
   [metabase.query-processor.card :as qp.card]
   [metabase.query-processor.dashboard :as qp.dashboard]
   [metabase.request.core :as request]
   [metabase.util :as u]
   [metabase.util.log :as log]))

(set! *warn-on-reflection* true)

(def ^:private max-parameter-combinations
  "How many of the combinations of parameter values people applied most often to a question are refreshed."
  10)

(def ^:private min-early-refresh-ms
  "How long, at least, before the results of a `:duration` policy expire to refresh them: two runs of the task, so that
  a pass falls due before they lapse."
  (u/minutes->ms 2))

(def ^:private default-period-ms
  "The caching period assumed for a schedule whose period can't be worked out (one that never fires again)."
  (u/hours->ms 24))

;;; ------------------------------------------------ When to refresh -------------------------------------------------

(defn- duration-ms
  "How long a `:duration` strategy `config` keeps results, in milliseconds."
  [{:keys [duration unit]}]
  (t/as (t/duration (long duration) (keyword unit)) :millis))

(defn- early-refresh-ms
  "How long before results cached for `window-ms` expire to refresh them: [[min-early-refresh-ms]] before the requests
  that hit them would start refreshing them themselves (the last [[cache/query-caching-early-refresh-ratio]] of the
  window, see [[metabase.query-processor.middleware.cache]]), but no more than half the window."
  [window-ms]
  (min (quot window-ms 2)
       (+ min-early-refresh-ms
          (long (* (max 0.0 (double (cache/query-caching-early-refresh-ratio))) window-ms)))))

(defn- period-ms
  "How long one caching period of `cache-config` lasts, in milliseconds: its duration, or the time between two runs of
  its schedule after `now`."
  [{:keys [strategy config]} now]
  (case strategy
    :duration (duration-ms config)
    :schedule (let [schedule  (:schedule config)
                    next-run  (cache.schedule/next-run-after schedule now)
                    run-after (some->> next-run (cache.schedule/next-run-after schedule))]
                (if run-after
                  (.toMillis (t/duration next-run run-after))
                  default-period-ms))))

(defn- last-refreshed-at
  "When the results of `cache-config` were last refreshed, or nil when they never were."
  [cache-config]
  (some-> (get-in cache-config [:state :last_refreshed_at]) t/offset-date-time))

(defn- cards-invalidated-at
  "When a Card whose results `cache-config` covers was last cleared, or nil when none was. For a dashboard policy this
  looks at every Card on the dashboard, including those with a policy of their own, which at worst refreshes the
  dashboard's results once more than needed."
  [{:keys [model model_id]}]
  (case model
    "question"  (refresh.db/card-cache-invalidated-at model_id)
    "dashboard" (refresh.db/dashboard-cards-cache-invalidated-at model_id)))

(defn- refresh-due?
  "Whether the results of `cache-config` are due to be refreshed at `now`, given `cards-invalidated-at`, when one of the
  Cards it covers was last cleared: they never were refreshed, they were made stale since (by clearing the policy or a
  Card, or by the policy's schedule), or (for a `:duration` policy) they are about to expire."
  [{:keys [strategy config] :as cache-config} cards-invalidated-at now]
  (let [refreshed-at (last-refreshed-at cache-config)
        stale-since  (cache.schedule/latest (:invalidated-at (cache-config/card-strategy cache-config nil))
                                            cards-invalidated-at)]
    (boolean
     (or (nil? refreshed-at)
         (and stale-since
              (t/before? (t/instant refreshed-at) (t/instant stale-since)))
         (and (= strategy :duration)
              (let [window-ms (duration-ms config)
                    due-at    (t/plus (t/instant refreshed-at)
                                      (t/millis (- window-ms (early-refresh-ms window-ms))))]
                (not (t/before? (t/instant now) due-at))))))))

(defn- claim!
  "Record that a refresh of the results of the CacheConfig with `id` starts at `now`, when one is due, and return the
  CacheConfig as it was before. Nil when no refresh is due, or someone else claimed it first: claims are made under a
  cluster lock."
  [id cards-invalidated-at now]
  (cluster-lock/with-cluster-lock ::claim
    (when-let [current (cache.db/cache-config id)]
      (when (and (:refresh_automatically current)
                 (refresh-due? current cards-invalidated-at now))
        (refresh.db/record-cache-config-state! id (assoc (:state current) :last_refreshed_at (str now)))
        current))))

;;; ------------------------------------------------- What to refresh ------------------------------------------------

(defn- per-person-results?
  "Whether the results of queries against the Database with `database-id` may differ from person to person, because it
  has row and column security or connection impersonation."
  [database-id]
  (or (data-access/sandboxes-in-database? database-id)
      (data-access/impersonations-in-database? database-id)))

(defn- covered-cards
  "The Cards whose results `cache-config` decides how to cache, as `[cards dashboard-id]`: the question's own Card, or
  the Cards on the dashboard that have no policy of their own. `dashboard-id` restricts the runs looked at to those on
  that dashboard."
  [{:keys [id model model_id]}]
  (case model
    "question"  [(some-> (refresh.db/card model_id) vector) nil]
    "dashboard" (if (refresh.db/dashboard-exists? model_id)
                  [(->> (into (set (refresh.db/dashcard-card-ids model_id))
                              (refresh.db/dashcard-series-card-ids model_id))
                        vec
                        refresh.db/cards
                        (filterv #(= id (:id (cache.strategies/effective-config % model_id)))))
                   model_id]
                  [[] model_id])))

(defn- runs-to-repeat
  "The runs of `card`'s query (on the Dashboard with `dashboard-id` only, when given) to repeat, as the `:hash` and
  `:dashboard_id` of each query: those people ran most often since `since`, or the one they last ran when they didn't
  run any since."
  [card dashboard-id since]
  (->> (or (not-empty (refresh.db/most-run-queries (:id card) dashboard-id since max-parameter-combinations))
           (some-> (refresh.db/last-run-query (:id card) dashboard-id) vector))
       (m/distinct-by (comp codecs/bytes->hex :hash))))

(defn- stored-queries
  "The stored query of each run in `runs`, keyed by the hex of its hash."
  [runs]
  (into {}
        (map (juxt (comp codecs/bytes->hex :query_hash) :query))
        (refresh.db/queries-with-hashes (mapv :hash runs))))

;;; ---------------------------------------------------- Refresh -----------------------------------------------------

(defn- rerun!
  "Run `card`'s query again with the parameter values and constraints of `stored-query`, the stored form of a query run
  for it before, on the Dashboard with `dashboard-id` when it was run on one, and cache its fresh results. Goes the
  same way as running the card through the API, so that the results are cached under the key the API looks them up by.
  Returns whether the query completed."
  [card dashboard-id {:keys [parameters constraints]}]
  (let [result (binding [qp.card/*allow-arbitrary-mbql-parameters* (some? dashboard-id)]
                 (qp.card/process-query-for-card
                  card :api
                  :parameters     (some->> (not-empty parameters) (lib/normalize ::lib.schema.parameter/parameters))
                  :constraints    (some->> constraints (lib/normalize ::lib.schema.constraints/constraints))
                  :context        :cache-refresh
                  :dashboard-id   dashboard-id
                  :ignore-cache   true
                  :card-transform (when dashboard-id qp.dashboard/card-with-default-metric-dimension)
                  :make-run       (fn [qp _export-format]
                                    (fn [query info]
                                      (qp (update query :info merge info) nil)))))]
    (when-not (= :completed (:status result))
      (log/warnf "Couldn't refresh the cached results of Card %d: %s" (:id card) (:error result)))
    (= :completed (:status result))))

(defn- refresh-card!
  "Run again the queries of `card` people ran since `since` (on the Dashboard with `dashboard-id` only, when given), and
  cache their fresh results. Returns how many were refreshed and how many failed."
  [card dashboard-id since]
  (let [runs    (runs-to-repeat card dashboard-id since)
        queries (stored-queries runs)]
    (reduce (fn [counts {:keys [hash dashboard_id]}]
              (if-let [stored-query (get queries (codecs/bytes->hex hash))]
                (let [refreshed? (try
                                   (rerun! card dashboard_id stored-query)
                                   (catch Throwable e
                                     (log/warnf e "Couldn't refresh the cached results of Card %d" (:id card))
                                     false))]
                  (update counts (if refreshed? :refreshed :failed) inc))
                counts))
            {:refreshed 0, :failed 0}
            runs)))

(defn- refresh-cache-config!
  "Refresh the cached results of `cache-config` if they are due at `now`. Returns how many queries were refreshed and how
  many failed, or nil when no refresh was due."
  [{:keys [id model model_id] :as cache-config} now]
  (let [cards-invalidated-at (cards-invalidated-at cache-config)]
    (when-let [claimed (and (refresh-due? cache-config cards-invalidated-at now)
                            (claim! id cards-invalidated-at now))]
      (let [[cards dashboard-id] (covered-cards cache-config)
            per-person-results?  (memoize per-person-results?)
            since                (or (last-refreshed-at claimed)
                                     (t/minus now (t/millis (period-ms claimed now))))
            counts               (transduce (comp (remove (comp per-person-results? :database_id))
                                                  (map #(refresh-card! % dashboard-id since)))
                                            (partial merge-with +)
                                            {:refreshed 0, :failed 0}
                                            cards)]
        (log/infof "Refreshed %d cached results of %s %d automatically (%d failed)"
                   (:refreshed counts) model model_id (:failed counts))
        counts))))

(defn refresh-due-caches!
  "Record the runs of the schedules of `:schedule` caching policies, then refresh the cached results of every question
  and dashboard policy that refreshes them automatically and is due. Returns
  `{:policies_refreshed n, :queries_refreshed n, :queries_failed n}`."
  []
  (schedule-invalidation/invalidate-due-schedules!)
  (let [totals {:policies_refreshed 0, :queries_refreshed 0, :queries_failed 0}]
    (if-not (premium-features/enable-preemptive-caching?)
      totals
      ;; nobody in particular runs these queries, so they run with full permissions: on the Databases refreshed (no
      ;; row and column security or impersonation) results don't depend on who runs them, and people's own
      ;; permissions are still checked before cached results are served to them
      (request/with-current-user nil
        (request/as-admin
          (let [now (t/offset-date-time)]
            (reduce (fn [totals cache-config]
                      (if-let [counts (try
                                        (refresh-cache-config! cache-config now)
                                        (catch Throwable e
                                          (log/errorf e "Error refreshing the cached results of %s %d automatically"
                                                      (:model cache-config) (:model_id cache-config))
                                          nil))]
                        (-> totals
                            (update :policies_refreshed inc)
                            (update :queries_refreshed + (:refreshed counts))
                            (update :queries_failed + (:failed counts)))
                        totals))
                    totals
                    (refresh.db/refreshable-cache-configs))))))))
