(ns metabase.sso.oidc.client
  "Metabase as an OpenID Connect relying party for single sign-on, configured by the `oidc-*` settings: provider
  discovery, the authorization request (with `state`, `nonce` and PKCE), the token request, the userinfo request, and
  the connection check behind the admin settings page.

  Failures throw an `ex-info` whose data has an `:sso/error` keyword saying what went wrong, which the login flow turns
  into a message on the sign-in page."
  (:require
   [clojure.string :as str]
   [metabase.sso.claims :as sso.claims]
   [metabase.sso.oidc.common :as oidc.common]
   [metabase.sso.oidc.discovery :as oidc.discovery]
   [metabase.sso.oidc.http :as oidc.http]
   [metabase.sso.oidc.id-token :as oidc.id-token]
   [metabase.sso.oidc.pkce :as oidc.pkce]
   [metabase.sso.settings :as sso.settings]
   [metabase.util.i18n :refer [tru]]
   [metabase.util.log :as log]
   [ring.util.codec :as codec])
  (:import
   (java.nio.charset StandardCharsets)
   (java.util Base64)))

(set! *warn-on-reflection* true)

(defn- fail!
  "Throw an `ex-info` with `message` whose data names the failure `error`."
  ([error message]
   (fail! error message nil))
  ([error message cause]
   (throw (ex-info message {:sso/error error} cause))))

(defn- strip-trailing-slashes
  [s]
  (some-> s (str/replace #"/+$" "")))

(defn discovery-url
  "The URL of the discovery document of the provider at `issuer-uri`."
  [issuer-uri]
  (str (strip-trailing-slashes issuer-uri) "/.well-known/openid-configuration"))

;;; ------------------------------------------------ Discovery ------------------------------------------------

(defn provider-metadata
  "The discovery document of the provider at `issuer-uri`, fetched and cached by [[oidc.discovery]].

  Throws unless the document could be fetched, declares an issuer equal to `issuer-uri` apart from trailing slashes,
  and names the authorization, token and JWKS endpoints, all of them on a network the `oidc-allowed-networks` setting
  allows."
  [issuer-uri]
  (let [doc (oidc.discovery/discover-oidc-configuration issuer-uri)]
    (cond
      (nil? doc)
      (fail! :discovery-failed
             (tru "Could not fetch the OpenID Connect discovery document from {0}." (discovery-url issuer-uri)))

      (not= (strip-trailing-slashes issuer-uri) (strip-trailing-slashes (:issuer doc)))
      (fail! :issuer-mismatch
             (tru "The discovery document declares the issuer {0}, which does not match the issuer URI {1}."
                  (pr-str (:issuer doc)) (pr-str issuer-uri)))

      :else
      (let [config {:discovery-document doc}]
        (try
          (when-not (oidc.discovery/validate-configuration config)
            (fail! :discovery-incomplete
                   (tru "The discovery document does not name the authorization, token and JWKS endpoints.")))
          (catch clojure.lang.ExceptionInfo e
            (if (:sso/error (ex-data e))
              (throw e)
              (fail! :network-blocked (ex-message e) e))))
        doc))))

(defn configuration
  "The OpenID Connect settings, with the provider's discovery document under `:metadata`. Throws when the settings are
  incomplete or the provider can't be discovered."
  []
  (when-not (sso.settings/oidc-configured)
    (fail! :not-configured (tru "OpenID Connect is not configured.")))
  (let [issuer-uri (sso.settings/oidc-issuer-uri)]
    {:issuer-uri           issuer-uri
     :client-id            (sso.settings/oidc-client-id)
     :client-secret        (sso.settings/oidc-client-secret)
     :scopes               (sso.settings/oidc-scope-list)
     :authorization-params (sso.settings/parse-oidc-authorization-params (sso.settings/oidc-authorization-params))
     :metadata             (provider-metadata issuer-uri)}))

;;; ------------------------------------------------ Authorization request ------------------------------------------------

(defn authorization-url
  "The URL of the authorization request that starts a sign-in, for the authorization code flow with PKCE. The extra
  authorization parameters of `config` are added first, so they can't replace the ones Metabase sets."
  [{:keys [client-id scopes authorization-params metadata]} {:keys [redirect-uri state nonce code-verifier]}]
  (let [endpoint (oidc.discovery/get-authorization-endpoint {:discovery-document metadata})
        params   (merge authorization-params
                        {"response_type"         "code"
                         "client_id"             client-id
                         "redirect_uri"          redirect-uri
                         "scope"                 (str/join " " scopes)
                         "state"                 state
                         "nonce"                 nonce
                         "code_challenge"        (oidc.pkce/code-challenge code-verifier)
                         "code_challenge_method" "S256"})]
    (str endpoint
         (if (str/includes? endpoint "?") "&" "?")
         (oidc.common/build-query-string params))))

;;; ------------------------------------------------ Token request ------------------------------------------------

(def ^:private client-auth-methods
  "How a client authenticates at the token endpoint, keyed by the names discovery documents use for them."
  {:client-secret-post  "client_secret_post"
   :client-secret-basic "client_secret_basic"})

(defonce ^:private ^{:doc "The client authentication method that last worked at each token endpoint."}
  working-client-auth-methods
  (atom {}))

(defn- client-auth-method-order
  "The client authentication methods to try at `token-endpoint`, in order: the one that worked last time first, then
  those the discovery document `metadata` lists, `client_secret_post` before `client_secret_basic`. Applications often
  accept only the one they were registered with, so both are tried."
  [metadata token-endpoint]
  (let [supported (set (:token_endpoint_auth_methods_supported metadata))
        listed    (filter #(contains? supported (client-auth-methods %)) [:client-secret-post :client-secret-basic])
        methods   (if (seq listed) listed [:client-secret-post :client-secret-basic])
        previous  (get @working-client-auth-methods token-endpoint)]
    (distinct (if (some #{previous} methods) (cons previous methods) methods))))

(defn- basic-authorization-header
  "The HTTP Basic `Authorization` header value for the client credentials, form-encoded first as RFC 6749 section
  2.3.1 asks."
  [client-id client-secret]
  (str "Basic " (.encodeToString (Base64/getEncoder)
                                 (.getBytes (str (codec/form-encode client-id) ":" (codec/form-encode client-secret))
                                            StandardCharsets/UTF_8))))

(defn- post-token-request
  [token-endpoint method client-id client-secret form-params]
  (oidc.http/oidc-post token-endpoint
                       (case method
                         :client-secret-post  {:form-params (assoc form-params
                                                                   :client_id     client-id
                                                                   :client_secret client-secret)
                                               :coerce      :always}
                         :client-secret-basic {:form-params form-params
                                               :headers     {"Authorization" (basic-authorization-header
                                                                              client-id client-secret)}
                                               :coerce      :always})))

(defn- client-auth-rejected?
  "Whether the token endpoint refused the client's credentials (or the way they were sent)."
  [{:keys [status body]}]
  (or (= 401 status)
      (and (map? body)
           (contains? #{"invalid_client" "unauthorized_client"} (:error body)))))

(defn token-request
  "POST `form-params` to the token endpoint of the provider described by `metadata`, authenticating as the client. When
  the endpoint refuses the credentials sent one way, the other way is tried. Returns the HTTP response, whose `:body`
  is the parsed JSON response with keyword keys. Throws when the endpoint can't be reached."
  [metadata client-id client-secret form-params]
  (let [token-endpoint (oidc.discovery/get-token-endpoint {:discovery-document metadata})]
    (loop [[method & more] (client-auth-method-order metadata token-endpoint)]
      (let [response (try
                       (post-token-request token-endpoint method client-id client-secret form-params)
                       (catch Exception e
                         (fail! :token-request-failed
                                (tru "Could not reach the token endpoint {0}: {1}" token-endpoint (ex-message e))
                                e)))]
        (cond
          (and (client-auth-rejected? response) (seq more))
          (recur more)

          (client-auth-rejected? response)
          response

          :else
          (do (swap! working-client-auth-methods assoc token-endpoint method)
              response))))))

(defn- token-error-description
  [{:keys [status body]}]
  (if (map? body)
    (str/join ": " (remove str/blank? [(:error body) (:error_description body)]))
    (str "HTTP " status)))

(defn exchange-code
  "Exchange the authorization `code` for tokens. Returns the token response body, which has an `:id_token`."
  [{:keys [client-id client-secret metadata]} {:keys [code redirect-uri code-verifier]}]
  (let [response (token-request metadata client-id client-secret
                                (cond-> {:grant_type   "authorization_code"
                                         :code         code
                                         :redirect_uri redirect-uri}
                                  code-verifier (assoc :code_verifier code-verifier)))]
    (cond
      (not= 200 (:status response))
      (fail! :token-request-failed
             (tru "The token endpoint refused the authorization code: {0}" (token-error-description response)))

      (not (and (map? (:body response)) (string? (get-in response [:body :id_token]))))
      (fail! :token-request-failed (tru "The token endpoint did not return an ID token."))

      :else
      (:body response))))

;;; ------------------------------------------------ Claims ------------------------------------------------

(defn fetch-userinfo
  "The claims of the userinfo endpoint for `access-token`, with string keys, or nil when the provider has no userinfo
  endpoint or the request fails."
  [{:keys [metadata]} access-token]
  (when-let [endpoint (and (not (str/blank? access-token))
                           (:userinfo_endpoint metadata))]
    (try
      (let [response (oidc.http/oidc-get endpoint {:headers {"Authorization" (str "Bearer " access-token)}
                                                   :as      :json-string-keys
                                                   :coerce  :always})]
        (if (and (= 200 (:status response)) (map? (:body response)))
          (:body response)
          (log/warnf "The userinfo endpoint %s answered with HTTP %s" endpoint (:status response))))
      (catch Exception e
        (log/warnf "Could not fetch userinfo from %s: %s" endpoint (ex-message e))
        nil))))

(defn- configured-claim-paths
  "The claim paths the settings read user details from."
  []
  (into (filterv some? [(sso.settings/oidc-attribute-email)
                        (sso.settings/oidc-attribute-firstname)
                        (sso.settings/oidc-attribute-lastname)
                        (sso.settings/oidc-attribute-groups)])
        (map second)
        (sso.claims/parse-attribute-mappings (sso.settings/oidc-user-attributes))))

(defn verified-claims
  "The claims of the verified ID token in `tokens`, with string keys.

  When the ID token lacks a claim the settings read user details from, the userinfo endpoint is asked as well, and
  its claims fill the gaps; the ID token's claims win where both have one. Userinfo is only used when its `sub` is the
  ID token's, as OpenID Connect Core section 5.3.2 requires. Throws when the ID token doesn't verify."
  [{:keys [issuer-uri client-id client-secret metadata] :as config} tokens nonce]
  (let [result (oidc.id-token/verify (:id_token tokens)
                                     {:jwks-uri      (oidc.discovery/get-jwks-uri {:discovery-document metadata})
                                      :issuer        (:issuer metadata)
                                      :client-id     client-id
                                      :client-secret client-secret
                                      :nonce         nonce})]
    (when-not (:valid? result)
      (fail! :invalid-token (tru "The ID token from {0} is not valid: {1}" issuer-uri (:message result))))
    (let [claims (:claims result)]
      (if (every? #(some? (sso.claims/claim-value claims %)) (configured-claim-paths))
        claims
        (let [userinfo (fetch-userinfo config (:access_token tokens))]
          (cond
            (nil? userinfo)
            claims

            (not= (get userinfo "sub") (get claims "sub"))
            (do (log/warn "Ignoring userinfo whose sub does not match the ID token's")
                claims)

            :else
            (merge userinfo claims)))))))

;;; ------------------------------------------------ Connection check ------------------------------------------------

(defn- check-discovery
  [issuer-uri]
  (oidc.discovery/invalidate-cache! issuer-uri)
  (try
    {:success  true
     :metadata (provider-metadata issuer-uri)}
    (catch clojure.lang.ExceptionInfo e
      {:success false
       :message (ex-message e)})))

(defn- check-credentials
  "Check the client credentials by redeeming a made-up authorization code. A provider authenticates the client before
  it looks at the code, so `invalid_grant` means the credentials were accepted, and `invalid_client` or HTTP 401 means
  they were not."
  [metadata client-id client-secret redirect-uri]
  (try
    (let [response (token-request metadata client-id client-secret
                                  {:grant_type    "authorization_code"
                                   :code          "metabase-connection-check"
                                   :redirect_uri  redirect-uri
                                   :code_verifier (oidc.pkce/generate-code-verifier)})
          error    (get-in response [:body :error])]
      (cond
        (client-auth-rejected? response)
        {:success  false
         :verified true
         :message  (tru "The provider rejected the client ID or client secret ({0})." (token-error-description response))}

        (= "invalid_grant" error)
        {:success  true
         :verified true
         :message  (tru "The provider accepted the client credentials.")}

        :else
        {:success  true
         :verified false
         :message  (tru "The provider answered without confirming the client credentials ({0}). Try signing in to check them."
                        (token-error-description response))}))
    (catch clojure.lang.ExceptionInfo e
      {:success  false
       :verified false
       :message  (ex-message e)})))

(defn check-connection
  "Check that the provider at `issuer-uri` can be discovered and that it accepts `client-id` and `client-secret`.
  Returns `{:ok <bool>, :issuer <the discovered issuer>, :discovery {...}, :credentials {...}}`; each step has
  `:success` and a `:message`."
  [{:keys [issuer-uri client-id client-secret]} redirect-uri]
  (let [discovery (check-discovery issuer-uri)]
    (if-not (:success discovery)
      {:ok        false
       :discovery (select-keys discovery [:success :message])}
      (let [metadata    (:metadata discovery)
            credentials (check-credentials metadata client-id client-secret redirect-uri)]
        {:ok          (boolean (:success credentials))
         :issuer      (:issuer metadata)
         :discovery   {:success true
                       :message (tru "Found the provider''s discovery document.")}
         :credentials credentials}))))
