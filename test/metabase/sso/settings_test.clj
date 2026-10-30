(ns metabase.sso.settings-test
  (:require
   [clojure.test :refer :all]
   [metabase.settings.core :as setting]
   [metabase.sso.ldap :as ldap]
   [metabase.sso.ldap-test-util :as ldap.test]
   [metabase.sso.ldap.settings :as sso.ldap.settings]
   [metabase.sso.settings :as sso.settings]
   [metabase.startup.core :as startup]
   [metabase.test :as mt]))

(deftest ldap-enabled-test
  (ldap.test/with-ldap-server!
    (testing "`ldap-enabled` setting validates currently saved LDAP settings"
      (mt/with-temporary-setting-values [ldap-enabled false]
        (mt/with-dynamic-fn-redefs [ldap/test-current-ldap-details (constantly {:status :ERROR :message "test error"})]
          (is (thrown-with-msg? clojure.lang.ExceptionInfo
                                #"Unable to connect to LDAP server"
                                (sso.ldap.settings/ldap-enabled! true))))
        (mt/with-dynamic-fn-redefs [ldap/test-current-ldap-details (constantly {:status :SUCCESS})]
          (sso.ldap.settings/ldap-enabled! true)
          (is (sso.ldap.settings/ldap-enabled))
          (sso.ldap.settings/ldap-enabled! false)
          (is (not (sso.ldap.settings/ldap-enabled))))))))

(deftest ^:parallel send-new-sso-user-admin-email?-test
  (is ((some-fn nil? boolean?) (sso.settings/send-new-sso-user-admin-email?))
      "Make sure this Setting returns a boolean, not some other type of value. (It was returning a function before I fixed it.)"))

(deftest ldap-group-mappings-invalid-dn-test
  (testing "a mapping keyed by something other than a DN is a bad request that names the key and shows an example"
    (let [before (sso.settings/ldap-group-mappings)]
      (is (thrown-with-msg? clojure.lang.ExceptionInfo
                            #"^qwf is not a valid DN\. Example: cn=people,ou=groups,dc=example,dc=org$"
                            (sso.settings/ldap-group-mappings! {"qwf" [1]})))
      (is (= "qwf is not a valid DN. Example: cn=people,ou=groups,dc=example,dc=org"
             (mt/user-http-request :crowberto :put 400 "setting" {:ldap-group-mappings {"qwf" [1]}})))
      (testing "the rejected write left the stored mappings alone"
        (is (= before (sso.settings/ldap-group-mappings)))))))

(deftest ldap-attribute-defaults-read-as-unset-test
  (testing "an attribute left at its default reports no value, even though its getter lower-cases it"
    (mt/with-temporary-setting-values [ldap-attribute-email     nil
                                       ldap-attribute-firstname nil
                                       ldap-attribute-lastname  nil]
      (doseq [k [:ldap-attribute-email :ldap-attribute-firstname :ldap-attribute-lastname]]
        (testing k
          (is (nil? (setting/user-facing-value k))))))))

(deftest oidc-allowed-networks-is-environment-only-test
  (testing "the policy is read from the environment only: a value that reached the setting table -- an older
           version's admin API, a serialization import, a direct write -- is ignored, not trusted"
    (mt/with-temp-env-var-value! [mb-oidc-allowed-networks nil]
      (mt/with-temporary-raw-setting-values [oidc-allowed-networks "external-only"]
        (is (= :allow-all (sso.settings/oidc-allowed-networks))))))
  (testing "and the environment still wins over a stored value"
    (mt/with-temp-env-var-value! [mb-oidc-allowed-networks "external-only"]
      (mt/with-temporary-raw-setting-values [oidc-allowed-networks "allow-all"]
        (is (= :external-only (sso.settings/oidc-allowed-networks))))))
  (testing "an unrecognized policy is refused outright"
    (mt/with-temp-env-var-value! [mb-oidc-allowed-networks "allow-everything"]
      (is (thrown-with-msg? clojure.lang.ExceptionInfo
                            #"Invalid MB_OIDC_ALLOWED_NETWORKS"
                            (sso.settings/oidc-allowed-networks)))))
  (testing "nothing can write it: it is a read-only Setting"
    (is (thrown-with-msg? UnsupportedOperationException
                          #"read-only setting"
                          (setting/set! :oidc-allowed-networks :allow-all)))))

(deftest oidc-allowed-networks-startup-validation-test
  (testing "a policy the environment names but Metabase does not recognize stops the boot, rather than waiting
           for the first login to discover it"
    (mt/with-temp-env-var-value! [mb-oidc-allowed-networks "allow-everything"]
      (is (thrown-with-msg? clojure.lang.ExceptionInfo
                            #"Invalid MB_OIDC_ALLOWED_NETWORKS"
                            (startup/def-startup-validation! ::sso.settings/oidc-allowed-networks)))))
  (testing "a policy it does recognize lets the boot continue"
    (mt/with-temp-env-var-value! [mb-oidc-allowed-networks "external-only"]
      (is (= :external-only
             (startup/def-startup-validation! ::sso.settings/oidc-allowed-networks))))))

;;; ------------------------------------------------ JWT and OpenID Connect ------------------------------------------------

(deftest oidc-issuer-uri-test
  (mt/with-temporary-setting-values [oidc-issuer-uri nil]
    (testing "the discovery document URL is trimmed to the issuer; a trailing slash on the issuer is kept"
      (sso.settings/oidc-issuer-uri! " https://login.example.com/.well-known/openid-configuration ")
      (is (= "https://login.example.com" (sso.settings/oidc-issuer-uri)))
      (sso.settings/oidc-issuer-uri! "https://login.example.com/")
      (is (= "https://login.example.com/" (sso.settings/oidc-issuer-uri))))
    (testing "only absolute http(s) URLs"
      (is (thrown-with-msg? clojure.lang.ExceptionInfo #"must be an absolute URL"
                            (sso.settings/oidc-issuer-uri! "login.example.com")))
      (is (thrown-with-msg? clojure.lang.ExceptionInfo #"must be an absolute URL"
                            (sso.settings/oidc-issuer-uri! "ftp://login.example.com"))))))

(deftest oidc-scopes-test
  (mt/with-temporary-setting-values [oidc-scopes nil]
    (is (= ["openid" "email" "profile"] (sso.settings/oidc-scope-list)))
    (sso.settings/oidc-scopes! "email, profile  offline_access email")
    (is (= "email profile offline_access" (sso.settings/oidc-scopes)))
    (testing "openid is always requested, first"
      (is (= ["openid" "email" "profile" "offline_access"] (sso.settings/oidc-scope-list))))))

(deftest oidc-authorization-params-test
  (is (= {"audience" "https://api.example.com", "prompt" "login"}
         (sso.settings/parse-oidc-authorization-params "audience=https://api.example.com&prompt=login")))
  (is (= {"audience" "https://api.example.com", "connection" "bcc id"}
         (sso.settings/parse-oidc-authorization-params "audience=https%3A%2F%2Fapi.example.com\nconnection = bcc%20id\n")))
  (is (= {} (sso.settings/parse-oidc-authorization-params nil)))
  (is (thrown-with-msg? clojure.lang.ExceptionInfo #"must look like name=value"
                        (sso.settings/parse-oidc-authorization-params "audience")))
  (is (thrown-with-msg? clojure.lang.ExceptionInfo #"set by Metabase"
                        (sso.settings/parse-oidc-authorization-params "redirect_uri=https://evil.example.com"))))

(deftest sso-enabled-requires-configuration-test
  (mt/with-temporary-setting-values [oidc-enabled false
                                     oidc-issuer-uri nil
                                     oidc-client-id nil
                                     oidc-client-secret nil
                                     jwt-enabled false
                                     jwt-identity-provider-uri nil
                                     jwt-shared-secret nil]
    (testing "neither can be enabled before it is configured"
      (is (thrown-with-msg? clojure.lang.ExceptionInfo #"not configured" (sso.settings/oidc-enabled! true)))
      (is (thrown-with-msg? clojure.lang.ExceptionInfo #"not configured" (sso.settings/jwt-enabled! true))))
    (mt/with-temporary-setting-values [oidc-issuer-uri    "https://login.example.com/"
                                       oidc-client-id     "client"
                                       oidc-client-secret "secret"]
      (sso.settings/oidc-enabled! true)
      (is (sso.settings/oidc-enabled))
      (is (sso.settings/sso-enabled?))
      (is (sso.settings/sso-source-enabled? :oidc))
      (testing "clearing a required setting turns sign-in off"
        (sso.settings/oidc-client-secret! nil)
        (is (not (sso.settings/oidc-enabled)))))
    (mt/with-temporary-setting-values [jwt-identity-provider-uri "https://idp.example.com/login"
                                       jwt-shared-secret         "0123456789abcdef0123456789abcdef"]
      (sso.settings/jwt-enabled! true)
      (is (sso.settings/jwt-enabled))
      (is (sso.settings/sso-source-enabled? :jwt)))))

(deftest group-mappings-test
  (mt/with-temporary-setting-values [oidc-group-mappings nil]
    (testing "keys that arrive as keywords from a JSON request body are stored as the provider's group names"
      (sso.settings/oidc-group-mappings! {(keyword "https://example.com/roles/admin") [2 2], :analysts [3]})
      (is (= {"https://example.com/roles/admin" [2], "analysts" [3]} (sso.settings/oidc-group-mappings))))
    (testing "JSON is accepted"
      (sso.settings/oidc-group-mappings! "{\"Data Team\": [4, 5]}")
      (is (= {"Data Team" [4 5]} (sso.settings/oidc-group-mappings))))
    (testing "values must be lists of group IDs"
      (is (thrown-with-msg? clojure.lang.ExceptionInfo #"must be a list of group IDs"
                            (sso.settings/oidc-group-mappings! {"x" ["Administrators"]}))))
    (testing "the API writes them too"
      (mt/user-http-request :crowberto :put 204 "setting/oidc-group-mappings" {:value {"Engineering" [3]}})
      (is (= {"Engineering" [3]} (sso.settings/oidc-group-mappings))))))

(deftest oidc-email-domain-allowed-test
  (mt/with-temporary-setting-values [oidc-allowed-email-domains nil]
    (is (sso.settings/oidc-email-domain-allowed? "anyone@anywhere.example"))
    (sso.settings/oidc-allowed-email-domains! "Example.com, @example.org")
    (is (= "example.com,example.org" (sso.settings/oidc-allowed-email-domains)))
    (is (sso.settings/oidc-email-domain-allowed? "ada@example.com"))
    (is (sso.settings/oidc-email-domain-allowed? "ada@EXAMPLE.org"))
    (is (not (sso.settings/oidc-email-domain-allowed? "ada@sub.example.com")))
    (is (not (sso.settings/oidc-email-domain-allowed? "ada@example.com.evil.example")))))

(deftest send-new-sso-user-admin-email-test
  (testing "with SSO provided by this build, admins can turn the new-user email off; it is on by default"
    (mt/with-temporary-setting-values [send-new-sso-user-admin-email? nil]
      (is (true? (sso.settings/send-new-sso-user-admin-email?)))
      (sso.settings/send-new-sso-user-admin-email?! false)
      (is (false? (sso.settings/send-new-sso-user-admin-email?))))))

(deftest password-login-can-be-disabled-with-sso-test
  (testing "with an SSO method enabled, password login can be turned off"
    (mt/with-temporary-setting-values [jwt-identity-provider-uri "https://idp.example.com/login"
                                       jwt-shared-secret         "0123456789abcdef0123456789abcdef"
                                       jwt-enabled               true
                                       enable-password-login     false]
      (is (false? (setting/get :enable-password-login)))))
  (testing "without any SSO method, password login stays on"
    (mt/with-temporary-setting-values [jwt-enabled           false
                                       oidc-enabled          false
                                       google-auth-enabled   false
                                       ldap-enabled          false
                                       enable-password-login false]
      (is (true? (setting/get :enable-password-login))))))
