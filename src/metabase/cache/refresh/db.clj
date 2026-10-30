(ns metabase.cache.refresh.db
  "Application database queries for automatic cache refreshing. Every function here is a direct Toucan 2 call with no
  additional logic."
  (:require
   [metabase.cache.schema :as cache.schema]
   [metabase.lib.schema.id :as lib.schema.id]
   [metabase.util.json :as json]
   [metabase.util.malli :as mu]
   [metabase.util.malli.schema :as ms]
   [toucan2.core :as t2]))

(mu/defn refreshable-cache-configs :- [:sequential :map]
  "The CacheConfigs of questions and dashboards whose `:duration` or `:schedule` strategy refreshes results
  automatically."
  []
  (t2/select :model/CacheConfig
             :refresh_automatically true
             :model                 [:in ["question" "dashboard"]]
             :strategy              [:in [:duration :schedule]]))

(mu/defn record-cache-config-state! :- :int
  "Set the `state` of the CacheConfig with `id` to `state`, returning the number updated. Updates the raw table so that
  `updated_at`, which records changes to the configuration itself, is left alone."
  [id    :- ms/PositiveInt
   state :- ::cache.schema/cache-config.state]
  (t2/query-one {:update (t2/table-name :model/CacheConfig)
                 :set    {:state (json/encode state)}
                 :where  [:= :id [:auto/param id]]}))

(mu/defn card :- [:maybe :map]
  "The Card with `card-id`, or nil when there is none or it's archived."
  [card-id :- ::lib.schema.id/card]
  (t2/select-one :model/Card :id [:auto/param card-id] :archived false))

(mu/defn cards :- [:sequential :map]
  "The Cards with `card-ids` that aren't archived."
  [card-ids :- [:maybe [:sequential ::lib.schema.id/card]]]
  (t2/select :model/Card :id [:in card-ids] :archived false))

(mu/defn card-cache-invalidated-at :- [:maybe ms/TemporalInstant]
  "When the cached results of the Card with `card-id` were last cleared, or nil."
  [card-id :- ::lib.schema.id/card]
  (t2/select-one-fn :cache_invalidated_at [:model/Card :cache_invalidated_at] :id [:auto/param card-id]))

(mu/defn dashboard-cards-cache-invalidated-at :- [:maybe ms/TemporalInstant]
  "When the cached results of a Card on the Dashboard with `dashboard-id` (one of its cards, or a series added to one)
  were last cleared, or nil."
  [dashboard-id :- ::lib.schema.id/dashboard]
  (:invalidated_at
   (t2/query-one {:select [[[:max :cache_invalidated_at] :invalidated_at]]
                  :from   [(t2/table-name :model/Card)]
                  :where  [:or
                           [:in :id ^:allow-subquery {:select [:card_id]
                                     :from   [(t2/table-name :model/DashboardCard)]
                                     :where  [:= :dashboard_id [:auto/param dashboard-id]]}]
                           [:in :id ^:allow-subquery {:select [:s.card_id]
                                     :from   [[(t2/table-name :model/DashboardCardSeries) :s]]
                                     :join   [[(t2/table-name :model/DashboardCard) :dc]
                                              [:= :dc.id :s.dashboardcard_id]]
                                     :where  [:= :dc.dashboard_id [:auto/param dashboard-id]]}]]})))

(mu/defn dashboard-exists? :- :boolean
  "Whether the Dashboard with `dashboard-id` exists and isn't archived."
  [dashboard-id :- ::lib.schema.id/dashboard]
  (t2/exists? :model/Dashboard :id [:auto/param dashboard-id] :archived false))

(mu/defn dashcard-card-ids :- [:maybe [:set ::lib.schema.id/card]]
  "The ids of the Cards of the DashboardCards of the Dashboard with `dashboard-id`, or nil when there are none."
  [dashboard-id :- ::lib.schema.id/dashboard]
  (t2/select-fn-set :card_id :model/DashboardCard
                    :dashboard_id [:auto/param dashboard-id]
                    :card_id      [:not= nil]))

(mu/defn dashcard-series-card-ids :- [:maybe [:set ::lib.schema.id/card]]
  "The ids of the Cards added as series to the DashboardCards of the Dashboard with `dashboard-id`, or nil when there
  are none."
  [dashboard-id :- ::lib.schema.id/dashboard]
  (t2/select-fn-set :card_id :model/DashboardCardSeries
                    {:select [:s.card_id]
                     :from   [[(t2/table-name :model/DashboardCardSeries) :s]]
                     :join   [[(t2/table-name :model/DashboardCard) :dc] [:= :dc.id :s.dashboardcard_id]]
                     :where  [:= :dc.dashboard_id [:auto/param dashboard-id]]}))

(def ^:private run-query-hashes-query
  "The query execution rows of successful runs of a Card's query that people ran, as opposed to runs that refreshed its
  cached results."
  {:from  [(t2/table-name :model/QueryExecution)]
   :where [:and
           [:not= :context "cache-refresh"]
           [:= :error nil]]})

(mu/defn most-run-queries :- [:sequential [:map
                                           [:hash         bytes?]
                                           [:dashboard_id [:maybe ::lib.schema.id/dashboard]]]]
  "The `:hash` and `:dashboard_id` of the queries people ran most often for the Card with `card-id` since `since` (on
  the Dashboard with `dashboard-id` only, when given), most often run first, at most `limit` of them."
  [card-id      :- ::lib.schema.id/card
   dashboard-id :- [:maybe ::lib.schema.id/dashboard]
   since        :- ms/TemporalInstant
   limit        :- ms/PositiveInt]
  (t2/query (-> run-query-hashes-query
                (assoc :select   [:hash :dashboard_id [[:count :*] :runs]]
                       :group-by [:hash :dashboard_id]
                       :order-by [[:runs :desc]]
                       :limit    limit)
                (update :where conj
                        [:= :card_id [:auto/param card-id]]
                        [:>= :started_at [:auto/param since]]
                        (when dashboard-id
                          [:= :dashboard_id [:auto/param dashboard-id]])))))

(mu/defn last-run-query :- [:maybe [:map
                                    [:hash         bytes?]
                                    [:dashboard_id [:maybe ::lib.schema.id/dashboard]]]]
  "The `:hash` and `:dashboard_id` of the query people last ran for the Card with `card-id` (on the Dashboard with
  `dashboard-id`, when given), or nil when they never did."
  [card-id      :- ::lib.schema.id/card
   dashboard-id :- [:maybe ::lib.schema.id/dashboard]]
  (t2/query-one (-> run-query-hashes-query
                    (assoc :select   [:hash :dashboard_id]
                           :order-by [[:started_at :desc]]
                           :limit    1)
                    (update :where conj
                            [:= :card_id [:auto/param card-id]]
                            (when dashboard-id
                              [:= :dashboard_id [:auto/param dashboard-id]])))))

(mu/defn queries-with-hashes :- [:sequential :map]
  "The `:query_hash` and `:query` of the Queries with `query-hashes`."
  [query-hashes :- [:maybe [:sequential bytes?]]]
  (t2/select [:model/Query :query_hash :query] :query_hash [:in query-hashes]))
