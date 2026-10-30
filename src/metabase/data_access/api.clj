(ns metabase.data-access.api
  "`/api/mt` routes: row and column security policies (`/gtap`), connection impersonation policies
  (`/impersonation`) and user attributes (`/user`)."
  (:require
   [metabase.api.util.handlers :as handlers]
   [metabase.data-access.api.gtap]
   [metabase.data-access.api.impersonation]
   [metabase.data-access.api.user]))

(comment metabase.data-access.api.gtap/keep-me
         metabase.data-access.api.impersonation/keep-me
         metabase.data-access.api.user/keep-me)

(def ^{:arglists '([request respond raise])} routes
  "`/api/mt` routes."
  (handlers/route-map-handler
   {"/gtap"          'metabase.data-access.api.gtap
    "/impersonation" 'metabase.data-access.api.impersonation
    "/user"          'metabase.data-access.api.user}))
