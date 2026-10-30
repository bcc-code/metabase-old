(ns metabase.cache.refresh.settings
  (:require
   [metabase.settings.core :refer [defsetting]]
   [metabase.util.i18n :refer [deferred-tru]]))

(def min-trigger-secret-length
  "How long, at least, [[cache-refresh-trigger-secret]] must be for the endpoint it guards to be enabled."
  32)

(defsetting cache-refresh-trigger-secret
  (deferred-tru "Secret that a scheduler outside Metabase sends to run automatic cache refreshing.")
  :type       :string
  :visibility :internal
  :setter     :none
  :sensitive? true
  :export?    false
  :audit      :never
  :doc        (str "Set this to let a scheduler outside Metabase, such as Google Cloud Scheduler or Cloud Tasks, run "
                   "automatic cache refreshing with `POST /api/cache-refresh/run`, sending the secret in the "
                   "`X-Metabase-Cache-Refresh-Secret` header. Needed where background work gets no CPU between "
                   "requests, such as Cloud Run with request-based billing. It must be at least 32 characters long; "
                   "generate one with `openssl rand -hex 32`. Unset, the endpoint is disabled."))
