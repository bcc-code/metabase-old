(ns metabase.sso.integrations.jwt
  "The browser side of JWT single sign-on, compatible with Metabase's long-standing JWT flow:

  1. The sign-in button links to `GET /auth/sso?redirect=<path>`, which redirects to the identity provider URI with a
     `return_to` parameter holding that path.
  2. After signing the user in, the identity provider signs a JWT with the shared secret and sends the browser to
     `GET /auth/sso?jwt=<token>&return_to=<path>`. [[handle]] verifies the token, logs the user in, sets the session
     cookies and redirects to `return_to`.

  Failures end on the sign-in page with a message."
  (:require
   [clojure.string :as str]
   [metabase.auth-identity.core :as auth-identity]
   [metabase.request.core :as request]
   [metabase.sso.integrations.common :as sso.integrations]
   [metabase.sso.settings :as sso.settings]
   [metabase.util.log :as log]
   [ring.util.codec :as codec]
   [ring.util.response :as response]))

(set! *warn-on-reflection* true)

(defn identity-provider-url
  "The URL of the identity provider's sign-in page, with `return_to` set to `redirect`."
  [redirect]
  (let [uri (sso.settings/jwt-identity-provider-uri)]
    (str uri
         (if (str/includes? uri "?") "&" "?")
         (codec/form-encode {"return_to" redirect}))))

(defn- login
  [request token redirect]
  (let [result (try
                 (auth-identity/login! :provider/jwt
                                       (assoc request
                                              :token        token
                                              :redirect-url redirect
                                              :device-info  (request/device-info request)))
                 (catch Exception e
                   (log/error e "Unexpected error completing a JWT sign-in")
                   {:success? false, :error :server-error}))]
    (if (and (true? (:success? result)) (:session result))
      (do (log/infof "User %s signed in with JWT" (get-in result [:user :id]))
          (sso.integrations/session-response request (:session result) redirect))
      (do (log/warnf "JWT sign-in failed: %s" (or (:message result) (:error result)))
          (sso.integrations/login-error-response (sso.integrations/login-error-code result) redirect nil)))))

(defn handle
  "Handle a request to `/auth/sso`: without a `:jwt`, send the browser to the identity provider; with one, log in.
  Where the user ends up is `:return-to` (the identity provider's `return_to` parameter) or `:redirect` (the sign-in
  page's)."
  [request {:keys [jwt return-to redirect]}]
  (let [redirect (sso.integrations/safe-redirect (or (sso.integrations/blank->nil return-to)
                                                     (sso.integrations/blank->nil redirect)))]
    (cond
      (not (sso.settings/jwt-enabled))
      (sso.integrations/login-error-response "not-enabled" redirect nil)

      (str/blank? jwt)
      (response/redirect (identity-provider-url redirect))

      :else
      (login request jwt redirect))))
