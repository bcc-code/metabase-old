(ns metabase.sso.integrations.oidc-test
  "End-to-end tests of OpenID Connect sign-in against [[metabase.sso.oidc.mock-idp]], a real local HTTP provider."
  (:require
   [clojure.string :as str]
   [clojure.test :refer :all]
   [metabase.app-db.encryption-test-util :as encryption-tu]
   [metabase.sso.oidc.discovery :as oidc.discovery]
   [metabase.sso.oidc.mock-idp :as mock-idp]
   [metabase.sso.oidc.tokens :as oidc.tokens]
   [metabase.sso.test-helpers :as sso.test-helpers]
   [metabase.test :as mt]
   [metabase.test.fixtures :as fixtures]
   [metabase.test.http-client :as client]
   [metabase.util.encryption :as encryption]
   [ring.util.codec :as codec]
   [toucan2.core :as t2]))

(set! *warn-on-reflection* true)

(def ^:private test-secret
  (encryption/secret-key->hash "Orw0AAyzkO/kPTLJRxiyKoBHXa/d6ZcO+p+gpZO/wSQ="))

(use-fixtures :once
  (fixtures/initialize :test-users :web-server)
  (encryption-tu/with-encrypted-app-db-fixture test-secret))

(use-fixtures :each
  (fn [thunk]
    (binding [client/*url-prefix* ""]
      (thunk))))

(defn- do-with-oidc!
  "Run `thunk` with a mock provider (started with `idp-options`) configured and enabled as Metabase's OpenID Connect
  provider, against the namespace's encrypted app DB. `thunk` gets the provider."
  [idp-options thunk]
  (mock-idp/do-with-mock-idp
   idp-options
   (fn [idp]
    (encryption-tu/with-encrypted-app-db
      (oidc.discovery/clear-cache!)
      (oidc.tokens/clear-jwks-cache!)
      ;; rows the server thread must see are inserted outside `mt/with-temp`, whose rows it can't read, and are
      ;; deleted afterwards by this cleanup
      (mt/with-model-cleanup [:model/User :model/PermissionsGroup]
        (mt/with-temporary-setting-values [site-url                        (sso.test-helpers/localhost-site-url)
                                           ldap-enabled                    false
                                           oidc-issuer-uri                 (mock-idp/issuer idp)
                                           oidc-client-id                  mock-idp/client-id
                                           oidc-client-secret              mock-idp/client-secret
                                           oidc-scopes                     nil
                                           oidc-authorization-params       nil
                                           oidc-attribute-email            nil
                                           oidc-attribute-firstname        nil
                                           oidc-attribute-lastname         nil
                                           oidc-attribute-groups           nil
                                           oidc-user-attributes            nil
                                           oidc-group-sync                 false
                                           oidc-group-mappings             nil
                                           oidc-user-provisioning-enabled? true
                                           oidc-allowed-email-domains      nil
                                           oidc-enabled                    true]
          (thunk idp)))))))

(defn- cookie-header
  "The `Cookie` header a browser would send back after `response`."
  [response]
  (->> (get-in response [:headers "Set-Cookie"])
       (map #(first (str/split % #";")))
       (str/join "; ")))

(defn- start-sign-in!
  "Click the sign-in button: returns the authorization request URL Metabase redirects to and the cookies it set."
  ([] (start-sign-in! "/collection/root"))
  ([redirect]
   (let [response (mt/client-full-response :get 302 "/auth/sso/oidc"
                                           {:request-options {:redirect-strategy :none}}
                                           :redirect redirect)]
     {:location (get-in response [:headers "Location"])
      :cookies  (cookie-header response)})))

(defn- callback!
  "Follow the provider's redirect back to Metabase's callback with `params`, sending `cookies`."
  [cookies params]
  (apply mt/client-real-response :get 302 "/auth/sso/oidc/callback"
         {:request-options {:redirect-strategy :none
                            :headers           {"Cookie" cookies}}}
         (mapcat identity params)))

(defn- sign-in!
  "Sign in all the way through the mock provider as the user with `claims`. Returns the final response."
  ([idp claims]
   (sign-in! idp claims {}))
  ([idp claims authorize-options]
   (let [{:keys [location cookies]} (start-sign-in!)
         params                     (mock-idp/authorize! idp location claims authorize-options)]
     (callback! cookies params))))

(defn- location [response]
  (get-in response [:headers "Location"]))

(defn- login-error
  "The `sso_error` (and other query parameters) of a redirect to the sign-in page, or nil for any other redirect."
  [response]
  (let [[path query] (str/split (str (location response)) #"\?" 2)]
    (when (= "/auth/login" path)
      (codec/form-decode query))))

(def ^:private ada
  {"sub"            "idp|ada"
   "email"          "ada.oidc@example.com"
   "email_verified" true
   "given_name"     "Ada"
   "family_name"    "Lovelace"})

(defn- user-by-email [email]
  (t2/select-one [:model/User :id :email :first_name :last_name :sso_source :is_active :jwt_attributes]
                 :%lower.email email))

(defn- insert-user!
  "Insert a user the sign-in, served on another thread, can see. [[do-with-oidc!]] deletes it afterwards."
  [attributes]
  (t2/insert-returning-instance! :model/User (merge {:first_name "Test", :last_name "User"} attributes)))

(defn- insert-group!
  "Insert a group the sign-in, served on another thread, can see. [[do-with-oidc!]] deletes it afterwards."
  [group-name]
  (t2/insert-returning-pk! :model/PermissionsGroup {:name group-name}))

;;; ------------------------------------------------ Starting a sign-in ------------------------------------------------

(deftest ^:synchronized authorization-request-test
  (do-with-oidc! {} (fn [idp]
    (mt/with-temporary-setting-values [oidc-scopes               "openid email profile groups"
                                       oidc-authorization-params "audience=https://api.example.com&prompt=login"]
      (let [{:keys [location cookies]} (start-sign-in!)
            params                     (mock-idp/authorization-params location)]
        (testing "the browser goes to the provider's authorization endpoint"
          (is (str/starts-with? location (str (mock-idp/base-url idp) "/authorize?"))))
        (testing "the request asks for an authorization code with PKCE, state and nonce"
          (is (=? {"response_type"         "code"
                   "client_id"             mock-idp/client-id
                   "redirect_uri"          (str (sso.test-helpers/localhost-site-url) "/auth/sso/oidc/callback")
                   "scope"                 "openid email profile groups"
                   "code_challenge_method" "S256"
                   "code_challenge"        #"[A-Za-z0-9_-]{43}"
                   "state"                 #"[0-9a-f]{64}"
                   "nonce"                 #"[0-9a-f]{64}"
                   "audience"              "https://api.example.com"
                   "prompt"                "login"}
                  params)))
        (testing "the state lives in an encrypted cookie"
          (is (str/includes? cookies "metabase.OIDC_STATE="))))))))

(deftest ^:synchronized not-enabled-test
  (do-with-oidc! {} (fn [_idp]
    (mt/with-temporary-setting-values [oidc-enabled false]
      (let [response (mt/client-full-response :get 302 "/auth/sso/oidc"
                                              {:request-options {:redirect-strategy :none}}
                                              :redirect "/collection/root")]
        (is (= {"sso_error" "not-enabled", "redirect" "/collection/root"}
               (login-error response))))))))

(deftest ^:synchronized unreachable-provider-test
  (testing "a provider that can't be discovered sends the user back to the sign-in page, not to an error page"
    (do-with-oidc! {} (fn [_idp]
      (mt/with-temporary-setting-values [oidc-issuer-uri "http://127.0.0.1:1/nowhere"]
        (let [response (mt/client-full-response :get 302 "/auth/sso/oidc"
                                                {:request-options {:redirect-strategy :none}})]
          (is (= {"sso_error" "configuration"} (login-error response)))))))))

;;; ------------------------------------------------ Completing a sign-in ------------------------------------------------

(deftest ^:synchronized new-user-sign-in-test
  (do-with-oidc! {} (fn [idp]
    (let [analysts-id (insert-group! "OIDC analysts")
          other-id    (insert-group! "OIDC other")]
      (mt/with-temporary-setting-values [oidc-attribute-groups "https://example.com/claims/roles"
                                         oidc-group-sync       true
                                         oidc-group-mappings   {"analyst" [analysts-id], "other" [other-id]}
                                         oidc-user-attributes  "country, org_id=https://example.com/claims/org.id"]
        (let [response (sign-in! idp (assoc ada
                                            "https://example.com/claims/roles" ["analyst" "unmapped"]
                                            "https://example.com/claims/org"   {"id" 42}
                                            "country"                          "NO"))
              user     (user-by-email "ada.oidc@example.com")]
          (testing "the user lands where the sign-in started, signed in"
            (is (= "/collection/root" (location response)))
            (is (sso.test-helpers/successful-login? response)))
          (testing "an account is created from the ID token's claims"
            (is (=? {:first_name "Ada", :last_name "Lovelace", :sso_source :oidc, :is_active true}
                    user)))
          (testing "the provider's subject identifies the user from now on"
            (is (= "idp|ada" (t2/select-one-fn :provider_id :model/AuthIdentity
                                               :user_id (:id user) :provider "sso-oidc"))))
          (testing "user attributes are stored from the configured claims"
            (is (= {"country" "NO", "org_id" "42"} (:jwt_attributes user))))
          (testing "mapped groups are synced; unmapped claim values are ignored"
            (is (t2/exists? :model/PermissionsGroupMembership :user_id (:id user) :group_id analysts-id))
            (is (not (t2/exists? :model/PermissionsGroupMembership :user_id (:id user) :group_id other-id))))
          (testing "the token request carried the PKCE verifier and authenticated the client"
            (is (=? [{:method "client_secret_post"
                      :params {"grant_type"    "authorization_code"
                               "code_verifier" #"[A-Za-z0-9_-]{43}"
                               "redirect_uri"  (str (sso.test-helpers/localhost-site-url) "/auth/sso/oidc/callback")}}]
                    (mock-idp/token-requests idp))))
          (testing "signing in again updates the user and their groups"
            (let [response (sign-in! idp (assoc ada
                                                "given_name"                       "Augusta"
                                                "https://example.com/claims/roles" ["other"]))]
              (is (sso.test-helpers/successful-login? response))
              (is (=? {:id (:id user), :first_name "Augusta"} (user-by-email "ada.oidc@example.com")))
              (is (not (t2/exists? :model/PermissionsGroupMembership :user_id (:id user) :group_id analysts-id)))
              (is (t2/exists? :model/PermissionsGroupMembership :user_id (:id user) :group_id other-id))))))))))

(deftest ^:synchronized existing-user-is-linked-by-email-test
  (do-with-oidc! {} (fn [idp]
    (let [{user-id :id} (insert-user! {:email "grace.oidc@example.com", :first_name "Grace", :last_name "Hopper"})
          response (sign-in! idp {"sub" "idp|grace", "email" "Grace.OIDC@example.com"})]
      (is (sso.test-helpers/successful-login? response))
      (testing "names the token doesn't carry are kept"
        (is (=? {:id user-id, :first_name "Grace", :last_name "Hopper", :sso_source :oidc}
                (user-by-email "grace.oidc@example.com"))))
      (is (= "idp|grace" (t2/select-one-fn :provider_id :model/AuthIdentity :user_id user-id :provider "sso-oidc")))))))

(deftest ^:synchronized user-is-found-by-subject-test
  (testing "a user whose email changed at the provider keeps their account"
    (do-with-oidc! {} (fn [idp]
      (is (sso.test-helpers/successful-login? (sign-in! idp ada)))
      (let [user-id (:id (user-by-email "ada.oidc@example.com"))]
        (is (sso.test-helpers/successful-login? (sign-in! idp (assoc ada "email" "ada.new@example.com"))))
        (is (= "ada.new@example.com" (t2/select-one-fn :email :model/User :id user-id)))
        (is (nil? (user-by-email "ada.oidc@example.com"))))))))

(deftest ^:synchronized refused-sign-ins-test
  (do-with-oidc! {} (fn [idp]
    (testing "no account and user provisioning off"
      (mt/with-temporary-setting-values [oidc-user-provisioning-enabled? false]
        (is (= {"sso_error" "no-account", "redirect" "/collection/root"}
               (login-error (sign-in! idp ada))))
        (is (nil? (user-by-email "ada.oidc@example.com")))))
    (testing "an email domain that isn't allowed"
      (mt/with-temporary-setting-values [oidc-allowed-email-domains "metabase.com, example.org"]
        (is (= "domain-not-allowed" (get (login-error (sign-in! idp ada)) "sso_error")))
        (is (nil? (user-by-email "ada.oidc@example.com")))))
    (testing "an allowed email domain"
      (mt/with-temporary-setting-values [oidc-allowed-email-domains "metabase.com, example.com"]
        (is (sso.test-helpers/successful-login? (sign-in! idp ada)))))
    (testing "an email the provider says is unverified"
      (is (= "email-not-verified"
             (get (login-error (sign-in! idp (assoc ada "sub" "idp|eve", "email" "eve@example.com", "email_verified" false)))
                  "sso_error"))))
    (testing "no email claim, and no userinfo to fill it in"
      (is (= "email-missing" (get (login-error (sign-in! idp {"sub" "idp|anon"})) "sso_error"))))
    (testing "a deactivated account"
      (insert-user! {:email "gone.oidc@example.com", :is_active false})
      (is (= "account-disabled"
             (get (login-error (sign-in! idp {"sub" "idp|gone", "email" "gone.oidc@example.com"})) "sso_error")))))))

(deftest ^:synchronized invalid-responses-test
  (do-with-oidc! {} (fn [idp]
    (testing "an ID token whose nonce isn't the one Metabase sent"
      (is (= "invalid-token"
             (get (login-error (sign-in! idp ada {:nonce "replayed-nonce"})) "sso_error")))
      (is (nil? (user-by-email "ada.oidc@example.com"))))
    (testing "a callback whose state doesn't match the cookie"
      (let [{:keys [location cookies]} (start-sign-in!)
            params                     (mock-idp/authorize! idp location ada)]
        (is (= {"sso_error" "state"} (login-error (callback! cookies (assoc params :state "forged-state")))))))
    (testing "a callback without the state cookie"
      (let [{:keys [location]} (start-sign-in!)
            params             (mock-idp/authorize! idp location ada)]
        (is (= {"sso_error" "state"} (login-error (callback! "" params))))))
    (testing "an authorization code the provider doesn't know"
      (let [{:keys [location cookies]} (start-sign-in!)
            params                     (mock-idp/authorize! idp location ada)]
        (is (= "provider" (get (login-error (callback! cookies (assoc params :code "made-up"))) "sso_error")))))
    (testing "an error from the provider, whose code is shown but not its free-text description"
      (let [{:keys [location cookies]} (start-sign-in!)
            {:keys [state]}            (mock-idp/authorize! idp location ada)]
        (is (= {"sso_error" "provider", "sso_error_code" "access_denied", "redirect" "/collection/root"}
               (login-error (callback! cookies {:state             state
                                                :error             "access_denied"
                                                :error_description "Call 555-0100 to unlock your account"})))))))))

;;; ------------------------------------------------ Provider variations ------------------------------------------------

(deftest ^:synchronized key-rotation-test
  (testing "ID tokens signed with a key the provider rotated in after Metabase cached its JWKS verify"
    (do-with-oidc! {} (fn [idp]
      (is (sso.test-helpers/successful-login? (sign-in! idp ada)))
      (is (= 1 (mock-idp/jwks-requests idp)))
      (mock-idp/rotate-signing-key! idp "key-2")
      (is (sso.test-helpers/successful-login? (sign-in! idp ada)))
      (is (= 2 (mock-idp/jwks-requests idp)))))))

(deftest ^:synchronized signing-algorithms-test
  (doseq [alg [:ps256 :hs256]]
    (testing alg
      (do-with-oidc! {:id-token-alg alg} (fn [idp]
        (is (sso.test-helpers/successful-login? (sign-in! idp ada))))))))

(deftest ^:synchronized issuer-without-trailing-slash-test
  (testing "the issuer can be configured with or without the trailing slash the provider uses"
    (do-with-oidc! {:issuer-suffix "/"} (fn [idp]
      (mt/with-temporary-setting-values [oidc-issuer-uri (str (mock-idp/base-url idp) "/.well-known/openid-configuration")]
        (is (sso.test-helpers/successful-login? (sign-in! idp ada))))))))

(deftest ^:synchronized client-secret-basic-test
  (testing "a provider that only accepts HTTP Basic client authentication"
    (do-with-oidc! {:token-auth-methods ["client_secret_basic"]} (fn [idp]
      (is (sso.test-helpers/successful-login? (sign-in! idp ada)))
      (is (= ["client_secret_basic"] (map :method (mock-idp/token-requests idp)))))))
  (testing "a provider that advertises both methods but only accepts the one the client was registered with"
    (do-with-oidc! {:accepted-token-auth-methods ["client_secret_basic"]} (fn [idp]
      (is (sso.test-helpers/successful-login? (sign-in! idp ada)))
      (is (= ["client_secret_post" "client_secret_basic"] (map :method (mock-idp/token-requests idp))))
      (testing "the method that worked is used straight away next time"
        (is (sso.test-helpers/successful-login? (sign-in! idp ada)))
        (is (= ["client_secret_post" "client_secret_basic" "client_secret_basic"]
               (map :method (mock-idp/token-requests idp)))))))))

(deftest ^:synchronized userinfo-test
  (testing "claims missing from the ID token are read from the userinfo endpoint"
    (do-with-oidc! {} (fn [idp]
      (mock-idp/set-userinfo! idp "idp|ada" {"email" "ada.oidc@example.com", "given_name" "Ada", "family_name" "L."})
      (is (sso.test-helpers/successful-login? (sign-in! idp {"sub" "idp|ada", "family_name" "Lovelace"})))
      (testing "the ID token wins where both have a claim"
        (is (=? {:first_name "Ada", :last_name "Lovelace"} (user-by-email "ada.oidc@example.com"))))))))
