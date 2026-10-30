(ns metabase.sso.integrations.oidc
  "The browser side of OpenID Connect single sign-on (the authorization code flow with PKCE).

  1. The sign-in button links to `GET /auth/sso/oidc?redirect=<path>`. [[initiate]] stores a random `state`, `nonce`
     and PKCE code verifier, with the path to return to, in an encrypted, short-lived cookie, then redirects to the
     provider's authorization endpoint.
  2. The provider sends the browser back to `GET /auth/sso/oidc/callback?code=...&state=...`, the redirect URI to
     register with it. [[callback]] checks `state` against the cookie, then logs in through
     [[metabase.sso.providers.sso-oidc]], which redeems the code and verifies the ID token, and sets the session
     cookies.

  Every failure ends on the sign-in page with a message, never on an error page."
  (:require
   [clojure.string :as str]
   [metabase.auth-identity.core :as auth-identity]
   [metabase.request.core :as request]
   [metabase.sso.integrations.common :as sso.integrations]
   [metabase.sso.oidc.client :as oidc.client]
   [metabase.sso.oidc.common :as oidc.common]
   [metabase.sso.oidc.pkce :as oidc.pkce]
   [metabase.sso.oidc.state :as oidc.state]
   [metabase.sso.settings :as sso.settings]
   [metabase.system.core :as system]
   [metabase.util.log :as log]
   [ring.util.response :as response]))

(set! *warn-on-reflection* true)

(def ^:private state-provider
  "The provider the state cookie of an OpenID Connect sign-in is issued for."
  :sso-oidc)

(def callback-path
  "The path of the redirect URI to register with the identity provider."
  "/auth/sso/oidc/callback")

(defn callback-uri
  "The redirect URI to register with the identity provider, or nil while the site URL is unknown."
  []
  (when-let [site-url (sso.integrations/blank->nil (system/site-url))]
    (str site-url callback-path)))

(defn initiate
  "Start an OpenID Connect sign-in that returns to `redirect`: redirect to the provider's authorization endpoint with a
  new state cookie."
  [request redirect]
  (let [redirect (sso.integrations/safe-redirect redirect)]
    (cond
      (not (sso.settings/oidc-enabled))
      (sso.integrations/login-error-response "not-enabled" redirect nil)

      (nil? (callback-uri))
      (do (log/error "OpenID Connect sign-in needs the site URL to be set to build its redirect URI")
          (sso.integrations/login-error-response "configuration" redirect nil))

      :else
      (try
        (let [config        (oidc.client/configuration)
              state         (oidc.common/generate-state)
              nonce         (oidc.common/generate-nonce)
              code-verifier (oidc.pkce/generate-code-verifier)
              url           (oidc.client/authorization-url config {:redirect-uri  (callback-uri)
                                                                   :state         state
                                                                   :nonce         nonce
                                                                   :code-verifier code-verifier})]
          (oidc.state/set-oidc-state-cookie (response/redirect url)
                                            request
                                            {:state         state
                                             :nonce         nonce
                                             :redirect      redirect
                                             :provider      state-provider
                                             :code-verifier code-verifier}
                                            {:browser-id (:browser-id request)}))
        (catch Exception e
          ;; most likely the provider can't be discovered, or MB_ENCRYPTION_SECRET_KEY (needed to encrypt the state
          ;; cookie) isn't set
          (log/errorf e "Could not start an OpenID Connect sign-in: %s" (ex-message e))
          (sso.integrations/login-error-response "configuration" redirect nil))))))

(defn- complete-login
  "Log in with the authorization `code` of a callback whose state cookie checked out, and answer with the session
  cookies and a redirect to where the sign-in started, or with the sign-in page and an error."
  [request code {:keys [nonce state-data]} redirect]
  (let [result (try
                 (auth-identity/login! :provider/sso-oidc
                                       (assoc request
                                              :code               code
                                              :oidc-nonce         nonce
                                              :oidc-code-verifier (:code-verifier state-data)
                                              :redirect-uri       (callback-uri)
                                              :redirect-url       redirect
                                              :device-info        (request/device-info request)))
                 (catch Exception e
                   (log/error e "Unexpected error completing an OpenID Connect sign-in")
                   {:success? false, :error :server-error}))]
    (if (and (true? (:success? result)) (:session result))
      (do (log/infof "User %s signed in with OpenID Connect" (get-in result [:user :id]))
          (sso.integrations/session-response request (:session result) redirect))
      (do (log/warnf "OpenID Connect sign-in failed: %s" (or (:message result) (:error result)))
          (sso.integrations/login-error-response (sso.integrations/login-error-code result) redirect nil)))))

(defn callback
  "Handle the provider's redirect back to Metabase, whose query parameters are `params`. The state cookie is cleared
  whatever happens, so it can't be used twice."
  [request {:keys [code state error error-description]}]
  (let [validation (when-not (str/blank? state)
                     (oidc.state/validate-oidc-callback request state state-provider
                                                        {:validate-browser-id (:browser-id request)}))
        redirect   (sso.integrations/safe-redirect (:redirect validation))
        response   (cond
                     (not (str/blank? error))
                     (do (log/warnf "The OpenID Connect provider refused the sign-in: %s %s" error (or error-description ""))
                         (sso.integrations/login-error-response "provider" redirect error))

                     (not (:valid? validation))
                     (do (log/warnf "OpenID Connect callback with an invalid state: %s"
                                    (or (:message validation) "no state parameter"))
                         (sso.integrations/login-error-response "state" nil nil))

                     (str/blank? code)
                     (sso.integrations/login-error-response "provider" redirect nil)

                     :else
                     (complete-login request code validation redirect))]
    (oidc.state/clear-oidc-state-cookie response)))
