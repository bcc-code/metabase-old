(ns metabase.sso.integrations.common
  "Ring responses shared by the browser-facing JWT and OpenID Connect sign-in flows.

  A sign-in that fails sends the browser back to the sign-in page with an `sso_error` query parameter naming what went
  wrong; the page shows a matching message. Only these fixed codes travel in the URL, never free text, so a crafted
  link can't put words of its choosing on the sign-in page. The details are logged."
  (:require
   [clojure.string :as str]
   [java-time.api :as t]
   [metabase.request.core :as request]
   [metabase.sso.oidc.state :as oidc.state]
   [ring.util.codec :as codec]
   [ring.util.response :as response]))

(set! *warn-on-reflection* true)

(def login-page-path
  "Where a failed sign-in sends the browser."
  "/auth/login")

(def ^:private error->code
  "The `sso_error` code the sign-in page shows for each `:error` of a failed login."
  {:not-enabled                "not-enabled"
   :not-configured             "configuration"
   :discovery-failed           "configuration"
   :discovery-incomplete       "configuration"
   :issuer-mismatch            "configuration"
   :network-blocked            "configuration"
   :token-request-failed       "provider"
   :invalid-state              "state"
   :invalid-token              "invalid-token"
   :email-missing              "email-missing"
   :email-not-verified         "email-not-verified"
   :email-domain-not-allowed   "domain-not-allowed"
   :user-provisioning-disabled "no-account"
   :non-personal-user          "not-allowed"})

(defn login-error-code
  "The `sso_error` code for the failed login `result`. The login pipeline reports a deactivated account with a message
  rather than a keyword `:error`."
  [{:keys [error]}]
  (if (keyword? error)
    (get error->code error "server")
    "account-disabled"))

(defn safe-redirect
  "`redirect` when it is a path on this Metabase or an absolute URL on its own origin, otherwise `/`."
  [redirect]
  (if (and (string? redirect)
           ;; browsers read a backslash as a slash, so `/\example.com` would leave the site
           (not (re-find #"[\\\s]" redirect))
           (oidc.state/valid-redirect-url? redirect))
    redirect
    "/"))

(defn- sanitize-provider-error
  "An OAuth error code from the identity provider, kept only when it looks like one (RFC 6749 section 4.1.2.1)."
  [error]
  (when (and (string? error) (re-matches #"[a-z_]{1,64}" error))
    error))

(defn login-error-response
  "A redirect to the sign-in page showing the error `code`. `redirect`, when it isn't the home page, is kept so another
  attempt still ends up there; `provider-error`, an OAuth error code the identity provider returned, is shown too."
  ([code]
   (login-error-response code nil nil))
  ([code redirect provider-error]
   (let [provider-error (sanitize-provider-error provider-error)]
     (response/redirect
      (str login-page-path "?"
           (codec/form-encode (cond-> {"sso_error" code}
                                (and redirect (not= redirect "/")) (assoc "redirect" redirect)
                                provider-error                     (assoc "sso_error_code" provider-error))))))))

(defn session-response
  "A redirect to `redirect` that sets the cookies of the new `session`."
  [request session redirect]
  (request/set-session-cookies request
                               (response/redirect redirect)
                               session
                               (t/zoned-date-time (t/zone-id "GMT"))))

(defn blank->nil
  "`s`, or nil when it is blank."
  [s]
  (when-not (str/blank? s)
    s))
