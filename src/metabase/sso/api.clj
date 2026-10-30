(ns metabase.sso.api
  (:require
   [metabase.api.macros :as api.macros]
   [metabase.api.util.handlers :as handlers]
   [metabase.sso.api.google]
   [metabase.sso.api.jwt]
   [metabase.sso.api.ldap]
   [metabase.sso.api.oidc]))

(comment metabase.sso.api.google/keep-me
         metabase.sso.api.jwt/keep-me
         metabase.sso.api.ldap/keep-me
         metabase.sso.api.oidc/keep-me)

(def ^{:arglists '([request respond raise])} google-auth-routes
  "`/api/google/` routes."
  (api.macros/ns-handler 'metabase.sso.api.google))

(def ^{:arglists '([request respond raise])} ldap-routes
  "`/api/ldap` routes."
  (api.macros/ns-handler 'metabase.sso.api.ldap))

(def ^{:arglists '([request respond raise])} sso-routes
  "`/api/sso` routes: the admin endpoints of JWT (`/api/sso/jwt`) and OpenID Connect (`/api/sso/oidc`) single
  sign-on."
  (handlers/route-map-handler
   {"/jwt"  'metabase.sso.api.jwt
    "/oidc" 'metabase.sso.api.oidc}))
