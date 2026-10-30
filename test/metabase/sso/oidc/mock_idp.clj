(ns metabase.sso.oidc.mock-idp
  "A small OpenID Connect provider served from a local `com.sun.net.httpserver.HttpServer`, for testing Metabase's
  OpenID Connect sign-in end to end over real HTTP: discovery, JWKS (with key rotation), a token endpoint that checks
  the client credentials, the redirect URI and the PKCE verifier, and a userinfo endpoint.

  A test sends Metabase's authorization redirect to [[authorize!]], which plays the user signing in at the provider
  and returns the `code` and `state` the provider would send back to Metabase's callback."
  (:require
   [buddy.core.keys :as buddy.keys]
   [buddy.sign.jwt :as jwt]
   [clojure.string :as str]
   [metabase.sso.oidc.pkce :as oidc.pkce]
   [metabase.util.json :as json]
   [ring.util.codec :as codec])
  (:import
   (com.sun.net.httpserver HttpExchange HttpHandler HttpServer)
   (java.net InetSocketAddress URI)
   (java.nio.charset StandardCharsets)
   (java.security KeyPair KeyPairGenerator)
   (java.util Base64)))

(set! *warn-on-reflection* true)

(def client-id
  "The client ID the mock provider knows Metabase by."
  "metabase-test-client")

(def client-secret
  "The client secret the mock provider knows Metabase by."
  "metabase-test-client-secret-0123456789")

(defn- new-signing-key
  [kid]
  (let [generator (doto (KeyPairGenerator/getInstance "RSA") (.initialize 2048))
        key-pair  ^KeyPair (.generateKeyPair generator)]
    {:kid kid, :private (.getPrivate key-pair), :public (.getPublic key-pair)}))

(defn- now-seconds []
  (quot (System/currentTimeMillis) 1000))

;;; ------------------------------------------------ HTTP plumbing ------------------------------------------------

(defn- respond!
  [^HttpExchange exchange status body]
  (let [json?  (not (string? body))
        ^bytes bs (.getBytes (if json? (json/encode body) ^String body) StandardCharsets/UTF_8)]
    (.add (.getResponseHeaders exchange) "Content-Type" (if json? "application/json" "text/plain"))
    (.sendResponseHeaders exchange (int status) (long (alength bs)))
    (with-open [out (.getResponseBody exchange)]
      (.write out bs))))

(defn- request-header
  [^HttpExchange exchange header]
  (.getFirst (.getRequestHeaders exchange) header))

(defn- form-params
  [^HttpExchange exchange]
  (let [body    (slurp (.getRequestBody exchange))
        decoded (codec/form-decode body)]
    (if (map? decoded) decoded {})))

;;; ------------------------------------------------ Endpoints ------------------------------------------------

(defn- discovery-document
  [{:keys [base-url issuer token-auth-methods]}]
  {:issuer                                issuer
   :authorization_endpoint                (str base-url "/authorize")
   :token_endpoint                        (str base-url "/oauth/token")
   :userinfo_endpoint                     (str base-url "/userinfo")
   :jwks_uri                              (str base-url "/.well-known/jwks.json")
   :response_types_supported              ["code"]
   :subject_types_supported               ["public"]
   :id_token_signing_alg_values_supported ["RS256" "PS256" "HS256"]
   :code_challenge_methods_supported      ["S256"]
   :token_endpoint_auth_methods_supported token-auth-methods})

(defn- jwks
  [{:keys [signing-keys]}]
  {:keys (for [{:keys [kid public]} signing-keys]
           (merge (buddy.keys/public-key->jwk public)
                  {:kid kid, :use "sig"}))})

(defn- client-credentials
  "The client ID and secret a token request authenticated with, and how: `[method id secret]`."
  [exchange params]
  (if-let [authorization (request-header exchange "Authorization")]
    (let [^bytes decoded (.decode (Base64/getDecoder) ^String (subs authorization (count "Basic ")))
          [id secret]    (str/split (String. decoded StandardCharsets/UTF_8) #":" 2)]
      ["client_secret_basic" (codec/form-decode-str id) (codec/form-decode-str secret)])
    ["client_secret_post" (get params "client_id") (get params "client_secret")]))

(defn- sign-id-token
  [{:keys [signing-keys id-token-alg]} claims]
  (if (= :hs256 id-token-alg)
    (jwt/sign claims client-secret {:alg :hs256})
    (let [{:keys [kid private]} (last signing-keys)]
      (jwt/sign claims private {:alg (or id-token-alg :rs256), :header {:kid kid}}))))

(defn- token-response
  [state-atom exchange]
  (let [params                  (form-params exchange)
        [method id secret]      (client-credentials exchange params)
        {:keys [codes] :as idp} @state-atom
        {:keys [nonce code-challenge redirect-uri claims]
         :as   grant}           (get codes (get params "code"))]
    (swap! state-atom update :token-requests conj {:method method, :params (dissoc params "client_secret")})
    (cond
      (or (not (contains? (set (or (:accepted-token-auth-methods idp) (:token-auth-methods idp))) method))
          (not= client-id id)
          (not= client-secret secret))
      [401 {:error "invalid_client", :error_description "Client authentication failed"}]

      (nil? grant)
      [400 {:error "invalid_grant", :error_description "Invalid authorization code"}]

      (not= redirect-uri (get params "redirect_uri"))
      [400 {:error "invalid_grant", :error_description "redirect_uri mismatch"}]

      (not= code-challenge (some-> (get params "code_verifier") oidc.pkce/code-challenge))
      [400 {:error "invalid_grant", :error_description "PKCE verification failed"}]

      :else
      (let [now (now-seconds)]
        (swap! state-atom update :codes dissoc (get params "code"))
        [200 {:access_token (str "access-" (get params "code"))
              :token_type   "Bearer"
              :expires_in   3600
              :id_token     (sign-id-token idp (merge {"iss"   (:issuer idp)
                                                       "aud"   client-id
                                                       "exp"   (+ now 300)
                                                       "iat"   now
                                                       "nonce" nonce}
                                                      claims))}]))))

(defn- userinfo-response
  [state-atom exchange]
  (let [{:keys [userinfo access-tokens]} @state-atom
        token                            (some-> (request-header exchange "Authorization")
                                                 (str/replace #"^Bearer " ""))]
    (if-let [sub (get access-tokens token)]
      [200 (merge {"sub" sub} (get userinfo sub))]
      [401 {:error "invalid_token"}])))

(defn- handler
  [state-atom]
  (reify HttpHandler
    (handle [_ exchange]
      (try
        (let [path         (.getPath (.getRequestURI exchange))
              [status body] (case path
                              "/.well-known/openid-configuration" [200 (discovery-document @state-atom)]
                              "/.well-known/jwks.json"            (do (swap! state-atom update :jwks-requests inc)
                                                                      [200 (jwks @state-atom)])
                              "/oauth/token"                      (token-response state-atom exchange)
                              "/userinfo"                         (userinfo-response state-atom exchange)
                              [404 "Not found"])]
          (respond! exchange status body))
        (catch Throwable e
          (respond! exchange 500 (str e)))))))

;;; ------------------------------------------------ Test API ------------------------------------------------

(defn start!
  "Start a mock provider on a free local port. Options:

  - `:issuer-suffix`      - appended to the base URL to make the issuer (default `/`, the way Auth0 writes its issuer)
  - `:token-auth-methods` - the client authentication methods the token endpoint advertises and, unless
                            `:accepted-token-auth-methods` says otherwise, accepts (default both `client_secret_post` and
                            `client_secret_basic`)
  - `:accepted-token-auth-methods` - the client authentication methods the token endpoint really accepts, like an
                            application registered for just one of them
  - `:id-token-alg`       - `:rs256` (default), `:ps256` or `:hs256` (signed with the client secret)

  Returns the provider, an atom; stop it with [[stop!]]."
  ([] (start! {}))
  ([{:keys [issuer-suffix token-auth-methods accepted-token-auth-methods id-token-alg]
     :or   {issuer-suffix      "/"
            token-auth-methods ["client_secret_post" "client_secret_basic"]
            id-token-alg       :rs256}}]
   (let [server   (HttpServer/create (InetSocketAddress. "127.0.0.1" 0) 0)
         base-url (str "http://127.0.0.1:" (.getPort (.getAddress server)))
         idp      (atom {:server             server
                         :base-url           base-url
                         :issuer             (str base-url issuer-suffix)
                         :token-auth-methods token-auth-methods
                         :accepted-token-auth-methods accepted-token-auth-methods
                         :id-token-alg       id-token-alg
                         :signing-keys       [(new-signing-key "key-1")]
                         :codes              {}
                         :access-tokens      {}
                         :userinfo           {}
                         :token-requests     []
                         :jwks-requests      0})]
     (.createContext server "/" ^HttpHandler (handler idp))
     (.start server)
     idp)))

(defn stop!
  "Stop the mock provider `idp`."
  [idp]
  (.stop ^HttpServer (:server @idp) 0))

(defn do-with-mock-idp
  "Call `f` with a started mock provider (see [[start!]] for `options`), and stop it afterwards."
  [options f]
  (let [idp (start! options)]
    (try
      (f idp)
      (finally
        (stop! idp)))))

(defn base-url
  "The URL the mock provider `idp` is served at, e.g. `http://127.0.0.1:41234`."
  [idp]
  (:base-url @idp))

(defn issuer
  "The issuer of the mock provider `idp`: its base URL followed by the issuer suffix it was started with."
  [idp]
  (:issuer @idp))

(defn rotate-signing-key!
  "Start signing ID tokens with a new key, published alongside the old one in the JWKS."
  [idp kid]
  (swap! idp update :signing-keys conj (new-signing-key kid)))

(defn set-userinfo!
  "Make the userinfo endpoint answer with `claims` (plus `sub`) for the user `sub`."
  [idp sub claims]
  (swap! idp assoc-in [:userinfo sub] claims))

(defn authorization-params
  "The query parameters of the authorization request URL `location`."
  [location]
  (codec/form-decode (.getRawQuery (URI. location))))

(defn authorize!
  "Play a user signing in at the provider with the authorization request URL `location`, which Metabase redirected the
  browser to. `claims` (string keys, at least `sub`) go into the ID token; `:nonce` in `options` replaces the nonce the
  request asked for. Returns `{:code ..., :state ...}`, what the provider sends back to the redirect URI."
  ([idp location claims]
   (authorize! idp location claims {}))
  ([idp location claims {:keys [nonce]}]
   (let [params (authorization-params location)
         code   (str "code-" (random-uuid))]
     (swap! idp (fn [state]
                  (-> state
                      (assoc-in [:codes code] {:nonce          (or nonce (get params "nonce"))
                                               :code-challenge (get params "code_challenge")
                                               :redirect-uri   (get params "redirect_uri")
                                               :claims         claims})
                      (assoc-in [:access-tokens (str "access-" code)] (get claims "sub")))))
     {:code code, :state (get params "state")})))

(defn token-requests
  "The token requests the provider received, oldest first, as `{:method <client auth method>, :params <form params>}`."
  [idp]
  (:token-requests @idp))

(defn jwks-requests
  "How many times the JWKS was fetched."
  [idp]
  (:jwks-requests @idp))
