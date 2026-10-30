(ns metabase.query-processor.middleware.enterprise
  "Wrappers for enterprise-only QP middleware using [[defenterprise]]. Pre-processing and post-processing middleware can
  use [[defenterprise]] directly, since the top-level function is applied directly each during each QP run, meaning it
  gets the chance to dispatch correctly every time it is run; 'around' middleware (including 'execution' middleware)
  needs a helper function that invokes the [[defenterprise]] function during every QP run, rather than just once when
  all middleware is combined. See [[handle-audit-app-internal-queries]]
  and [[handle-audit-app-internal-queries-middleware]] for example."
  (:require
   [metabase.api.common :as api]
   [metabase.lib.core :as lib]
   [metabase.permissions.core :as perms]
   [metabase.premium-features.core :as premium-features :refer [defenterprise]]
   [metabase.query-processor.error-type :as qp.error-type]
   [metabase.query-processor.schema :as qp.schema]
   [metabase.util.i18n :as i18n]
   [metabase.util.log :as log]
   [metabase.util.malli :as mu]))

;;;; Pre-processing middleware

;;; (f query) => query

(defenterprise attach-destination-db-middleware
  "Pre-processing middleware. Calculates the destination database that should be used for this query, e.g. for caching
  purposes. Does not make any changes to the query besides (possibly) adding a `:destination-database/id` key."
  metabase-enterprise.database-routing.middleware
  [query]
  query)

(defenterprise apply-sandboxing
  "Pre-processing middleware. Replaces source tables a User was querying against with source queries that (presumably)
  restrict the rows returned, based on presence of sandboxes."
  metabase-enterprise.sandbox.query-processor.middleware.sandboxing
  [query]
  ((requiring-resolve 'metabase.data-access.core/apply-sandboxing) query))

(defenterprise apply-impersonation
  "Pre-processing middleware. Adds a key to the query if the user will be impersonated. Currently used solely for cache."
  metabase-enterprise.impersonation.middleware
  [query]
  ((requiring-resolve 'metabase.data-access.core/apply-impersonation) query))

(defenterprise apply-impersonation-postprocessing
  "Post-processing middleware to actually bind what's needed for impersonation"
  metabase-enterprise.impersonation.middleware
  [qp]
  ((requiring-resolve 'metabase.data-access.core/apply-impersonation-postprocessing) qp))

(defenterprise currently-impersonated?
  "True when a connection-impersonation role is bound for the current query."
  metabase-enterprise.impersonation.middleware
  []
  ((requiring-resolve 'metabase.data-access.core/currently-impersonated?)))

(defenterprise currently-db-routed?
  "True when DB routing has swapped in a destination DB for the current query. Read from the enterprise
  database-routing dynamic var. OSS: always false."
  metabase-enterprise.database-routing.middleware
  []
  false)

(defenterprise currently-destination-database-id
  "Destination DB id when DB routing has swapped one in for the current query, else nil. OSS: always nil."
  metabase-enterprise.database-routing.middleware
  []
  nil)

(defn apply-impersonation-postprocessing-middleware
  "Helper middleware wrapper for [[apply-impersonation-postprocessing]] to make sure we do [[defenterprise]] dispatch
  correctly on each QP run rather than just once when we combine all of the QP middleware"
  [qp]
  (fn [query rff]
    ((apply-impersonation-postprocessing qp) query rff)))

;;; Download permissions. Group download permissions only bind users acting as themselves: public links and static
;;; embeds run as an admin, and have download settings of their own.

(def ^:private download-contexts
  #{:csv-download :json-download :xlsx-download
    :embedded-csv-download :embedded-json-download :embedded-xlsx-download
    :public-csv-download :public-json-download :public-xlsx-download})

(defn- download-query?
  [query]
  (contains? download-contexts (-> query :info :context)))

(defn- current-user-download-level
  "The current user's download permission level for `query`, preprocessed for them; nil when their downloads aren't
  restricted: for admins, with no current user, or while the `advanced-permissions` feature is disabled. `:no` when
  the level can't be worked out."
  [query]
  (when (and (premium-features/enable-advanced-permissions?)
             api/*current-user-id*
             (not api/*is-superuser?*))
    (try
      ;; resolved late: query-permissions preprocesses queries, and preprocessing loads this namespace
      ((requiring-resolve 'metabase.query-permissions.core/download-perms-level)
       query api/*current-user-id* :already-preprocessed? true)
      (catch Throwable e
        (log/warn e "Error calculating download permissions; denying downloads")
        :no))))

(defenterprise apply-download-limit
  "Pre-processing middleware to apply row limits to MBQL export queries if the user has `limited` download perms. This
  does not apply to native queries, which are instead limited by the [[limit-download-result-rows]] post-processing
  middleware."
  metabase-enterprise.advanced-permissions.query-processor.middleware.permissions
  [query]
  (if (and (download-query? query)
           (not (lib/native-stage? query -1))
           (not (lib/current-page query -1))
           (= :ten-thousand-rows (current-user-download-level query)))
    (lib/limit query -1 (min perms/limited-download-row-limit
                             (or (lib/current-limit query -1) perms/limited-download-row-limit)))
    query))

;;;; Execution middleware

;;; (f qp) => qp

(defenterprise swap-destination-db
  "Must be the last middleware before we actually hit the database. If a Router Database is specified, swaps out the
   Metadata Provider for one that has the appropriate destination database."
  metabase-enterprise.database-routing.middleware
  [qp]
  qp)

(mu/defn swap-destination-db-middleware :- ::qp.schema/qp
  "Helper middleware wrapper for [[swap-destination-db]] to make sure we do [[defenterprise]] dispatch correctly on each QP run rather than just once when we combine all of the QP middleware"
  [qp :- ::qp.schema/qp]
  (fn [query rff]
    ((swap-destination-db qp) query rff)))

(def ^:private download-level->api-value
  {:one-million-rows  :full
   :ten-thousand-rows :limited
   :no                :none})

(defenterprise check-download-permissions
  "Middleware for queries that generate downloads, which checks that the user has permissions to download the results
  of the query, and aborts the query or limits the number of results if necessary.

  If this query is not run to generate an export (e.g. :export-format is :api) we return user's download permissions in
  the query metadata so that the frontend can determine whether to show the download option on the UI."
  metabase-enterprise.advanced-permissions.query-processor.middleware.permissions
  [qp]
  (fn [query rff]
    (let [level (current-user-download-level query)]
      (cond
        (nil? level)
        (qp query rff)

        (not (download-query? query))
        (qp query (fn [metadata]
                    (rff (assoc metadata :download_perms (download-level->api-value level)))))

        (= level :no)
        (throw (ex-info (i18n/tru "You do not have permissions to download the results of this query.")
                        {:type               qp.error-type/missing-required-permissions
                         :permissions-error? true}))

        :else
        (qp query rff)))))

(defn check-download-permissions-middleware
  "Helper middleware wrapper for [[check-download-permissions]] to make sure we do [[defenterprise]] dispatch
  correctly on each QP run rather than just once when we combine all of the QP middleware."
  [qp]
  (fn [query rff]
    ((check-download-permissions qp) query rff)))

;;;; Post-processing middleware

;;; (f query rff) => rff

(defenterprise limit-download-result-rows
  "Post-processing middleware to limit the number of rows included in downloads if the user has `limited` download
  perms. Mainly useful for native queries, which are not modified by the [[apply-download-limit]] pre-processing
  middleware."
  metabase-enterprise.advanced-permissions.query-processor.middleware.permissions
  [query rff]
  (if (and (download-query? query)
           (= :ten-thousand-rows (current-user-download-level query)))
    (fn limit-download-result-rows-rff [metadata]
      ((take perms/limited-download-row-limit) (rff metadata)))
    rff))

(defenterprise merge-sandboxing-metadata
  "Post-processing middleware. Marks the results of sandboxed queries and records the sandboxes that applied."
  metabase-enterprise.sandbox.query-processor.middleware.sandboxing
  [query rff]
  ((requiring-resolve 'metabase.data-access.core/merge-sandboxing-metadata) query rff))

;;;; Around middleware

;;; (f qp) => qp

(defenterprise handle-audit-app-internal-queries
  "'Around' middleware that handles `:internal` (Audit App) type queries."
  metabase-enterprise.audit-app.query-processor.middleware.handle-audit-queries
  [qp]
  (fn [{query-type :type, :as query} rff]
    (when (= (keyword query-type) :internal)
      (throw (ex-info (i18n/tru "Audit App queries are not enabled on this instance.")
                      {:type qp.error-type/invalid-query})))
    (qp query rff)))

(defn handle-audit-app-internal-queries-middleware
  "Helper middleware wrapper for [[handle-audit-app-internal-queries]] to make sure we do [[defenterprise]] dispatch
  correctly on each QP run rather than just once when we combine all of the QP middleware."
  [qp]
  (fn [query rff]
    ((handle-audit-app-internal-queries qp) query rff)))
