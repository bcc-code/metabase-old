(ns metabase.sso.api.oidc-auth
  "`/auth/sso/oidc` routes: the browser side of OpenID Connect single sign-on. See [[metabase.sso.integrations.oidc]]."
  (:require
   [metabase.api.macros :as api.macros]
   [metabase.sso.integrations.oidc :as sso.integrations.oidc]))

(set! *warn-on-reflection* true)

(api.macros/defendpoint :get "/" :- :any
  "Start an OpenID Connect sign-in: redirect to the identity provider, coming back to `redirect` afterwards."
  [_route-params
   {:keys [redirect]} :- [:map {:closed true}
                          [:redirect {:optional true} [:maybe :string]]]
   _body
   request]
  (sso.integrations.oidc/initiate request redirect))

(api.macros/defendpoint :get "/callback" :- :any
  "The OpenID Connect redirect URI: finish the sign-in the identity provider sends the browser back from."
  [_route-params
   query-params :- [:map {:closed true}
                    [:code  {:optional true} [:maybe :string]]
                    [:state {:optional true} [:maybe :string]]
                    [:error {:optional true} [:maybe :string]]]
   _body
   request]
  ;; OAuth names the error description `error_description`, which is only logged, so it is read off the request rather
  ;; than declared in the (kebab-case) query parameter schema
  (sso.integrations.oidc/callback request (assoc query-params
                                                 :error-description (get-in request [:query-params "error_description"]))))

(def ^{:arglists '([request respond raise])} routes
  "`/auth/sso/oidc` routes."
  (api.macros/ns-handler *ns*))
