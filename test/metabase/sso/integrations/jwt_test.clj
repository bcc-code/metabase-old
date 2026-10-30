(ns metabase.sso.integrations.jwt-test
  "End-to-end tests of JWT single sign-on through `GET /auth/sso`."
  (:require
   [buddy.sign.jwt :as jwt]
   [clojure.string :as str]
   [clojure.test :refer :all]
   [metabase.sso.test-helpers :as sso.test-helpers]
   [metabase.test :as mt]
   [metabase.test.fixtures :as fixtures]
   [metabase.test.http-client :as client]
   [ring.util.codec :as codec]
   [toucan2.core :as t2]))

(set! *warn-on-reflection* true)

(use-fixtures :once (fixtures/initialize :test-users))

(use-fixtures :each
  (fn [thunk]
    (binding [client/*url-prefix* ""]
      (thunk))))

(def ^:private shared-secret
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")

(def ^:private idp-uri "https://idp.example.com/sso/metabase")

(defn- do-with-jwt! [thunk]
  (mt/with-model-cleanup [:model/User :model/PermissionsGroup]
    (mt/with-temporary-setting-values [ldap-enabled                   false
                                       jwt-identity-provider-uri      idp-uri
                                       jwt-shared-secret              shared-secret
                                       jwt-attribute-email            nil
                                       jwt-attribute-firstname        nil
                                       jwt-attribute-lastname         nil
                                       jwt-attribute-groups           nil
                                       jwt-user-attributes            nil
                                       jwt-group-sync                 false
                                       jwt-group-mappings             nil
                                       jwt-user-provisioning-enabled? true
                                       jwt-enabled                    true]
      (thunk))))

(defmacro ^:private with-jwt! [& body]
  `(do-with-jwt! (fn [] ~@body)))

(defn- now-seconds []
  (quot (System/currentTimeMillis) 1000))

(defn- sign [claims]
  (jwt/sign (merge {"iat" (now-seconds)} claims) shared-secret {:alg :hs256}))

(defn- sso-request
  [& params]
  (apply mt/client-full-response :get 302 "/auth/sso" {:request-options {:redirect-strategy :none}} params))

(defn- location [response]
  (get-in response [:headers "Location"]))

(defn- login-error [response]
  (let [[path query] (str/split (str (location response)) #"\?" 2)]
    (when (= "/auth/login" path)
      (codec/form-decode query))))

(defn- user-by-email [email]
  (t2/select-one [:model/User :id :email :first_name :last_name :sso_source :is_active :jwt_attributes]
                 :%lower.email email))

(deftest redirect-to-identity-provider-test
  (with-jwt!
    (testing "without a token, the browser is sent to the identity provider with where to return to"
      (is (= (str idp-uri "?return_to=%2Fquestion%2F1")
             (location (sso-request :redirect "/question/1")))))
    (testing "an identity provider URI with a query string keeps it"
      (mt/with-temporary-setting-values [jwt-identity-provider-uri (str idp-uri "?app=metabase")]
        (is (= (str idp-uri "?app=metabase&return_to=%2F") (location (sso-request))))))
    (testing "a redirect off this site becomes the home page"
      (is (= (str idp-uri "?return_to=%2F") (location (sso-request :redirect "https://evil.example.com/"))))
      (is (= (str idp-uri "?return_to=%2F") (location (sso-request :redirect "//evil.example.com/"))))
      (is (= (str idp-uri "?return_to=%2F") (location (sso-request :redirect "/\\evil.example.com/")))))))

(deftest not-enabled-test
  (with-jwt!
    (mt/with-temporary-setting-values [jwt-enabled false]
      (is (= {"sso_error" "not-enabled", "redirect" "/question/1"}
             (login-error (sso-request :redirect "/question/1")))))))

(deftest sign-in-test
  (with-jwt!
    (let [analysts-id (t2/insert-returning-pk! :model/PermissionsGroup {:name "JWT analysts"})
          other-id    (t2/insert-returning-pk! :model/PermissionsGroup {:name "JWT other"})]
      (mt/with-temporary-setting-values [jwt-group-sync      true
                                         jwt-group-mappings  {"analysts" [analysts-id], "other" [other-id]}
                                         jwt-user-attributes "department, org_id=org.id"]
        (let [response (sso-request :jwt (sign {"email"      "ada.jwt@example.com"
                                                "first_name" "Ada"
                                                "last_name"  "Lovelace"
                                                "groups"     ["analysts"]
                                                "department" "Engineering"
                                                "org"        {"id" 7}})
                                    :return_to "/question/1")
              user     (user-by-email "ada.jwt@example.com")]
          (testing "the user is signed in and sent to return_to"
            (is (= "/question/1" (location response)))
            (is (sso.test-helpers/successful-login? response)))
          (testing "an account is created from the claims"
            (is (=? {:first_name "Ada", :last_name "Lovelace", :sso_source :jwt, :is_active true} user)))
          (testing "user attributes are stored from the configured claims"
            (is (= {"department" "Engineering", "org_id" "7"} (:jwt_attributes user))))
          (testing "mapped groups are synced"
            (is (t2/exists? :model/PermissionsGroupMembership :user_id (:id user) :group_id analysts-id))
            (is (not (t2/exists? :model/PermissionsGroupMembership :user_id (:id user) :group_id other-id))))
          (testing "a later sign-in updates names, attributes and groups"
            (is (sso.test-helpers/successful-login?
                 (sso-request :jwt (sign {"email" "ada.jwt@example.com", "first_name" "Augusta", "groups" ["other"]}))))
            (is (=? {:first_name "Augusta", :last_name "Lovelace", :jwt_attributes {}} (user-by-email "ada.jwt@example.com")))
            (is (not (t2/exists? :model/PermissionsGroupMembership :user_id (:id user) :group_id analysts-id)))
            (is (t2/exists? :model/PermissionsGroupMembership :user_id (:id user) :group_id other-id))))))))

(deftest custom-attribute-names-test
  (with-jwt!
    (mt/with-temporary-setting-values [jwt-attribute-email     "https://example.com/claims/email"
                                       jwt-attribute-firstname "profile.first"
                                       jwt-attribute-lastname  "profile.last"]
      (is (sso.test-helpers/successful-login?
           (sso-request :jwt (sign {"https://example.com/claims/email" "grace.jwt@example.com"
                                    "profile"                          {"first" "Grace", "last" "Hopper"}}))))
      (is (=? {:first_name "Grace", :last_name "Hopper"} (user-by-email "grace.jwt@example.com"))))))

(deftest refused-sign-ins-test
  (with-jwt!
    (testing "a token signed with another key"
      (is (= "invalid-token"
             (get (login-error (sso-request :jwt (jwt/sign {"email" "eve.jwt@example.com", "iat" (now-seconds)}
                                                           "the-wrong-secret-the-wrong-secret!!"
                                                           {:alg :hs256})))
                  "sso_error"))))
    (testing "a token issued too long ago"
      (is (= "invalid-token"
             (get (login-error (sso-request :jwt (sign {"email" "eve.jwt@example.com", "iat" (- (now-seconds) 3600)})))
                  "sso_error"))))
    (testing "an expired token"
      (is (= "invalid-token"
             (get (login-error (sso-request :jwt (sign {"email" "eve.jwt@example.com", "exp" (- (now-seconds) 600)})))
                  "sso_error"))))
    (testing "a token without an email"
      (is (= "email-missing" (get (login-error (sso-request :jwt (sign {"sub" "someone"}))) "sso_error"))))
    (testing "no account and user provisioning off"
      (mt/with-temporary-setting-values [jwt-user-provisioning-enabled? false]
        (is (= "no-account"
               (get (login-error (sso-request :jwt (sign {"email" "eve.jwt@example.com"}))) "sso_error")))))
    (is (nil? (user-by-email "eve.jwt@example.com")))
    (testing "a deactivated account"
      (t2/insert! :model/User {:email "gone.jwt@example.com", :first_name "Gone", :last_name "User", :is_active false})
      (is (= "account-disabled"
             (get (login-error (sso-request :jwt (sign {"email" "gone.jwt@example.com"}))) "sso_error"))))
    (testing "an existing account signs in even with user provisioning off"
      (t2/insert! :model/User {:email "existing.jwt@example.com", :first_name "Existing", :last_name "User"})
      (mt/with-temporary-setting-values [jwt-user-provisioning-enabled? false]
        (is (sso.test-helpers/successful-login?
             (sso-request :jwt (sign {"email" "existing.jwt@example.com"}))))))))

(deftest post-sign-in-test
  (testing "the token can be POSTed in a JSON body instead of travelling in the URL"
    (with-jwt!
      (let [response (mt/client-full-response :post 302 "/auth/sso"
                                              {:request-options {:redirect-strategy :none}}
                                              {:jwt (sign {"email" "post.jwt@example.com"})}
                                              :return_to "/question/2")]
        (is (= "/question/2" (location response)))
        (is (sso.test-helpers/successful-login? response))))))
