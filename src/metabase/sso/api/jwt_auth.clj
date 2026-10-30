(ns metabase.sso.api.jwt-auth
  "`/auth/sso` routes: the browser side of JWT single sign-on. See [[metabase.sso.integrations.jwt]]."
  (:require
   [clojure.string :as str]
   [metabase.api.macros :as api.macros]
   [metabase.sso.integrations.jwt :as sso.integrations.jwt]
   [metabase.util.i18n :refer [tru]]))

(set! *warn-on-reflection* true)

(defn- return-to
  "The `return_to` query parameter of `request`. The JWT flow has always named it this way, so identity providers set
  up for Metabase send it, and it is read here rather than declared in a (kebab-case) query parameter schema."
  [request]
  (let [value (get-in request [:query-params "return_to"])]
    (when (string? value)
      value)))

(api.macros/defendpoint :get "/" :- :any
  "Without a `jwt`, redirect to the JWT identity provider, which sends the browser back with one. With a `jwt`, sign
  in and redirect to the `return_to` query parameter."
  [_route-params
   {:keys [jwt redirect]} :- [:map {:closed true}
                              [:jwt      {:optional true} [:maybe :string]]
                              [:redirect {:optional true} [:maybe :string]]]
   _body
   request]
  (sso.integrations.jwt/handle request {:jwt jwt, :redirect redirect, :return-to (return-to request)}))

(api.macros/defendpoint :post "/" :- :any
  "Sign in with a JWT sent as `jwt` in a JSON request body, which keeps it out of URLs and logs, then redirect to the
  `return_to` query parameter."
  [_route-params
   _query-params
   body :- [:maybe [:map {:closed true}
                    [:jwt {:optional true} [:maybe :string]]]]
   request]
  (if (str/blank? (:jwt body))
    {:status 400
     :body   {:message (tru "Send the JWT as \"jwt\" in a JSON request body.")}}
    (sso.integrations.jwt/handle request {:jwt (:jwt body), :return-to (return-to request)})))

(def ^{:arglists '([request respond raise])} routes
  "`/auth/sso` routes for JWT."
  (api.macros/ns-handler *ns*))
