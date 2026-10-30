(ns metabase.sso.api.oidc
  "`/api/sso/oidc` endpoints: the admin side of OpenID Connect single sign-on."
  (:require
   [clojure.string :as str]
   [metabase.api.common :as api]
   [metabase.api.macros :as api.macros]
   [metabase.settings.core :as setting]
   [metabase.sso.integrations.oidc :as sso.integrations.oidc]
   [metabase.sso.oidc.client :as oidc.client]
   [metabase.sso.settings :as sso.settings]
   [metabase.util.encryption :as encryption]
   [metabase.util.i18n :refer [tru]]))

(set! *warn-on-reflection* true)

(def ^:private OIDCSettings
  [:map {:closed true}
   [:oidc-enabled                    {:optional true} [:maybe :boolean]]
   [:oidc-issuer-uri                 {:optional true} [:maybe :string]]
   [:oidc-client-id                  {:optional true} [:maybe :string]]
   [:oidc-client-secret              {:optional true} [:maybe :string]]
   [:oidc-scopes                     {:optional true} [:maybe :string]]
   [:oidc-authorization-params       {:optional true} [:maybe :string]]
   [:oidc-login-prompt               {:optional true} [:maybe :string]]
   [:oidc-attribute-email            {:optional true} [:maybe :string]]
   [:oidc-attribute-firstname        {:optional true} [:maybe :string]]
   [:oidc-attribute-lastname         {:optional true} [:maybe :string]]
   [:oidc-attribute-groups           {:optional true} [:maybe :string]]
   [:oidc-user-attributes            {:optional true} [:maybe :string]]
   [:oidc-user-provisioning-enabled? {:optional true} [:maybe :boolean]]
   [:oidc-allowed-email-domains      {:optional true} [:maybe :string]]])

(defn- effective-client-secret
  "The client secret `submitted` stands for: the saved one when it is the masked value the settings page shows for it,
  or when nothing was submitted."
  [submitted]
  (if (or (str/blank? submitted) (setting/obfuscated-value? submitted))
    (sso.settings/oidc-client-secret)
    submitted))

(defn- check-can-enable!
  "Throw a 400 unless sign-in can work with the issuer and client the admin is saving: the state cookie must be
  encryptable, the client ID and secret set, and the provider discoverable."
  [{:keys [oidc-issuer-uri oidc-client-id oidc-client-secret] :as settings}]
  (when-not (encryption/default-encryption-enabled?)
    (throw (ex-info (tru "OpenID Connect sign-in needs MB_ENCRYPTION_SECRET_KEY to be set, to encrypt the state of each sign-in.")
                    {:status-code 400})))
  (let [issuer-uri    (sso.settings/normalize-oidc-issuer (if (contains? settings :oidc-issuer-uri)
                                                            oidc-issuer-uri
                                                            (sso.settings/oidc-issuer-uri)))
        client-id     (if (contains? settings :oidc-client-id) oidc-client-id (sso.settings/oidc-client-id))
        client-secret (if (contains? settings :oidc-client-secret)
                        (effective-client-secret oidc-client-secret)
                        (sso.settings/oidc-client-secret))]
    (when (some str/blank? [issuer-uri client-id client-secret])
      (throw (ex-info (tru "Set the issuer URI, client ID and client secret to turn on OpenID Connect sign-in.")
                      {:status-code 400})))
    (try
      (oidc.client/provider-metadata issuer-uri)
      (catch clojure.lang.ExceptionInfo e
        (throw (ex-info (ex-message e) {:status-code 400} e))))))

(api.macros/defendpoint :get "/" :- [:map {:closed true}
                                     [:redirect-uri       [:maybe :string]]
                                     [:encryption-enabled :boolean]]
  "What the OpenID Connect settings page shows besides the settings: the redirect URI to register with the identity
  provider (nil until the site URL is known) and whether MB_ENCRYPTION_SECRET_KEY, which sign-in needs, is set."
  []
  (api/check-superuser)
  {:redirect-uri       (sso.integrations.oidc/callback-uri)
   :encryption-enabled (boolean (encryption/default-encryption-enabled?))})

(api.macros/defendpoint :put "/settings" :- [:map {:closed true}
                                             [:oidc-enabled :boolean]]
  "Update the OpenID Connect settings. When sign-in is (or stays) turned on, first check that the provider can be
  discovered and that MB_ENCRYPTION_SECRET_KEY is set."
  [_route-params
   _query-params
   settings :- OIDCSettings]
  (api/check-superuser)
  (let [enable? (if (contains? settings :oidc-enabled)
                  (boolean (:oidc-enabled settings))
                  (sso.settings/oidc-enabled))]
    (when enable?
      (check-can-enable! settings))
    (setting/set-many! (dissoc settings :oidc-enabled))
    (sso.settings/oidc-enabled! enable?)
    {:oidc-enabled (sso.settings/oidc-enabled)}))

(def ^:private CheckStep
  [:map
   [:success                   :boolean]
   [:verified {:optional true} :boolean]
   [:message  {:optional true} [:maybe :string]]])

(api.macros/defendpoint :post "/check" :- [:map
                                           [:ok                           :boolean]
                                           [:issuer      {:optional true} [:maybe :string]]
                                           [:discovery                    CheckStep]
                                           [:credentials {:optional true} CheckStep]]
  "Check, without saving anything, that the OpenID Connect provider at `issuer-uri` can be discovered and accepts the
  client credentials. A blank or masked `client-secret` means the saved one."
  [_route-params
   _query-params
   {:keys [issuer-uri client-id client-secret]} :- [:map {:closed true}
                                                    [:issuer-uri    :string]
                                                    [:client-id     :string]
                                                    [:client-secret {:optional true} [:maybe :string]]]]
  (api/check-superuser)
  (let [issuer-uri    (sso.settings/normalize-oidc-issuer issuer-uri)
        client-secret (effective-client-secret client-secret)]
    (api/check-400 (not (str/blank? issuer-uri)) (tru "Enter the issuer URI."))
    (api/check-400 (not (str/blank? client-id)) (tru "Enter the client ID."))
    (api/check-400 (not (str/blank? client-secret)) (tru "Enter the client secret."))
    (oidc.client/check-connection {:issuer-uri    issuer-uri
                                   :client-id     (str/trim client-id)
                                   :client-secret client-secret}
                                  (or (sso.integrations.oidc/callback-uri)
                                      sso.integrations.oidc/callback-path))))
