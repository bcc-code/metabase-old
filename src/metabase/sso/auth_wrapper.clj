(ns metabase.sso.auth-wrapper
  (:require
   [metabase.api.util.handlers :as handlers]
   [metabase.config.core :as config]
   [metabase.sso.api.jwt-auth :as jwt-auth.api]
   [metabase.sso.api.oidc-auth :as oidc-auth.api]
   [metabase.sso.api.slack-connect :as slack-connect.api]
   [ring.util.response :as response]))

(let [bad-req (response/bad-request {:message "The auth/sso endpoint only exists in enterprise builds"
                                     :status "ee-build-required"})]
  (defn- not-enabled
    [_req respond _raise]
    (respond bad-req)))

(def ^:private oss-sso-routes
  "The browser-facing single sign-on routes this build implements itself: JWT at `/auth/sso`, OpenID Connect at
  `/auth/sso/oidc`. SAML, and the enterprise edition's OpenID Connect admin API, are not available."
  (handlers/routes
   (handlers/route-map-handler
    {"/auth" {"/sso" (handlers/routes
                      (handlers/route-map-handler {"/oidc" oidc-auth.api/routes})
                      jwt-auth.api/routes)}})
   (handlers/route-map-handler
    {"/api" {"/saml" not-enabled
             "/ee"   {"/sso" {"/oidc" not-enabled}}}})))

;; This needs to be injected into [[metabase.server.routes/make-routes]] -- not [[metabase.api-routes.core/routes]] !!!
(def routes
  "Ring routes for auth API endpoints.
   Slack Connect is always available. JWT and OpenID Connect are implemented here unless the enterprise edition's
   routes are on the classpath."
  (handlers/routes
   ;; Slack Connect routes always available (OSS)
   (handlers/route-map-handler {"/auth" {"/sso" {"/slack-connect" slack-connect.api/routes}}})
   (if (and config/ee-available? (not *compile-files*))
     (requiring-resolve 'metabase-enterprise.sso.api.routes/routes)
     oss-sso-routes)))
