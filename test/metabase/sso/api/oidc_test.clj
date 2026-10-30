(ns metabase.sso.api.oidc-test
  (:require
   [clojure.test :refer :all]
   [metabase.app-db.encryption-test-util :as encryption-tu]
   [metabase.settings.core :as setting]
   [metabase.sso.oidc.discovery :as oidc.discovery]
   [metabase.sso.oidc.mock-idp :as mock-idp]
   [metabase.sso.settings :as sso.settings]
   [metabase.test :as mt]
   [metabase.test.fixtures :as fixtures]
   [metabase.util.encryption :as encryption]))

(set! *warn-on-reflection* true)

(def ^:private test-secret
  (encryption/secret-key->hash "Orw0AAyzkO/kPTLJRxiyKoBHXa/d6ZcO+p+gpZO/wSQ="))

(use-fixtures :once
  (fixtures/initialize :test-users)
  (encryption-tu/with-encrypted-app-db-fixture test-secret))

(defmacro ^:private with-clean-oidc-settings! [& body]
  `(do
     (oidc.discovery/clear-cache!)
     (mt/with-temporary-setting-values [site-url                   "http://metabase.example.com"
                                        oidc-enabled               false
                                        oidc-issuer-uri            nil
                                        oidc-client-id             nil
                                        oidc-client-secret         nil
                                        oidc-login-prompt          nil
                                        oidc-scopes                nil
                                        oidc-authorization-params  nil
                                        oidc-allowed-email-domains nil]
       ~@body)))

(deftest permissions-test
  (testing "only admins can see or change the OpenID Connect settings"
    (is (= "You don't have permissions to do that."
           (mt/user-http-request :rasta :get 403 "sso/oidc")))
    (is (= "You don't have permissions to do that."
           (mt/user-http-request :rasta :put 403 "sso/oidc/settings" {:oidc-login-prompt "Sign in"})))
    (is (= "You don't have permissions to do that."
           (mt/user-http-request :rasta :post 403 "sso/oidc/check" {:issuer-uri "https://idp.example.com"
                                                                    :client-id  "x"})))))

(deftest ^:synchronized info-test
  (with-clean-oidc-settings!
    (testing "the redirect URI to register at the provider is built from the site URL"
      (is (=? {:redirect-uri "http://metabase.example.com/auth/sso/oidc/callback"
               :encryption-enabled false}
              (mt/user-http-request :crowberto :get 200 "sso/oidc"))))
    (testing "with an encryption key"
      (encryption-tu/with-encrypted-app-db
        (is (=? {:encryption-enabled true} (mt/user-http-request :crowberto :get 200 "sso/oidc")))))))

(deftest ^:synchronized save-settings-test
  (mock-idp/do-with-mock-idp {} (fn [idp]
    (encryption-tu/with-encrypted-app-db
      (with-clean-oidc-settings!
        (testing "saving and enabling"
          (is (= {:oidc-enabled true}
                 (mt/user-http-request :crowberto :put 200 "sso/oidc/settings"
                                       {:oidc-issuer-uri           (str (mock-idp/base-url idp) "/.well-known/openid-configuration")
                                        :oidc-client-id            mock-idp/client-id
                                        :oidc-client-secret        mock-idp/client-secret
                                        :oidc-login-prompt         "Sign in with Example"
                                        :oidc-authorization-params "audience=https://api.example.com"
                                        :oidc-enabled              true})))
          (is (sso.settings/oidc-enabled))
          (testing "the discovery URL is trimmed to the issuer"
            (is (= (mock-idp/base-url idp) (sso.settings/oidc-issuer-uri)))))
        (testing "the client secret is masked when read, and saving the masked value keeps it"
          (let [masked (setting/user-facing-value :oidc-client-secret)]
            (is (not= mock-idp/client-secret masked))
            (mt/user-http-request :crowberto :put 200 "sso/oidc/settings" {:oidc-client-secret masked
                                                                           :oidc-login-prompt  "Sign in"})
            (is (= mock-idp/client-secret (sso.settings/oidc-client-secret)))
            (is (= "Sign in" (sso.settings/oidc-login-prompt)))))
        (testing "an issuer that can't be discovered can't be enabled, and nothing is saved"
          (is (re-find #"Could not fetch the OpenID Connect discovery document"
                       (mt/user-http-request :crowberto :put 400 "sso/oidc/settings"
                                             {:oidc-issuer-uri "http://127.0.0.1:1/nowhere"
                                              :oidc-enabled    true})))
          (is (= (mock-idp/base-url idp) (sso.settings/oidc-issuer-uri))))
        (testing "invalid values are refused"
          (is (re-find #"set by Metabase"
                       (mt/user-http-request :crowberto :put 400 "sso/oidc/settings"
                                             {:oidc-authorization-params "state=abc"})))
          (is (re-find #"not a valid email domain"
                       (mt/user-http-request :crowberto :put 400 "sso/oidc/settings"
                                             {:oidc-allowed-email-domains "example.com, not a domain!"}))))
        (testing "turning sign-in off"
          (is (= {:oidc-enabled false}
                 (mt/user-http-request :crowberto :put 200 "sso/oidc/settings" {:oidc-enabled false})))))))))

(deftest ^:synchronized enable-requires-encryption-test
  (mock-idp/do-with-mock-idp {} (fn [idp]
    (with-clean-oidc-settings!
      (with-redefs [encryption/default-encryption-enabled? (constantly false)]
        (is (re-find #"MB_ENCRYPTION_SECRET_KEY"
                     (mt/user-http-request :crowberto :put 400 "sso/oidc/settings"
                                           {:oidc-issuer-uri    (mock-idp/issuer idp)
                                            :oidc-client-id     mock-idp/client-id
                                            :oidc-client-secret mock-idp/client-secret
                                            :oidc-enabled       true})))
        (is (not (sso.settings/oidc-enabled))))))))

(deftest ^:synchronized check-connection-test
  (mock-idp/do-with-mock-idp {} (fn [idp]
    (with-clean-oidc-settings!
      (testing "a reachable provider that accepts the credentials"
        (is (=? {:ok          true
                 :issuer      (mock-idp/issuer idp)
                 :discovery   {:success true}
                 :credentials {:success true, :verified true}}
                (mt/user-http-request :crowberto :post 200 "sso/oidc/check"
                                      {:issuer-uri    (mock-idp/issuer idp)
                                       :client-id     mock-idp/client-id
                                       :client-secret mock-idp/client-secret}))))
      (testing "wrong credentials"
        (is (=? {:ok          false
                 :discovery   {:success true}
                 :credentials {:success false, :verified true, :message #".*rejected the client ID or client secret.*"}}
                (mt/user-http-request :crowberto :post 200 "sso/oidc/check"
                                      {:issuer-uri    (mock-idp/issuer idp)
                                       :client-id     mock-idp/client-id
                                       :client-secret "wrong"}))))
      (testing "a provider that can't be discovered"
        (is (=? {:ok        false
                 :discovery {:success false, :message #"Could not fetch.*"}}
                (mt/user-http-request :crowberto :post 200 "sso/oidc/check"
                                      {:issuer-uri    "http://127.0.0.1:1/nowhere"
                                       :client-id     mock-idp/client-id
                                       :client-secret "x"}))))
      (testing "a blank secret means the saved one"
        (mt/with-temporary-setting-values [oidc-client-secret mock-idp/client-secret]
          (is (=? {:ok true}
                  (mt/user-http-request :crowberto :post 200 "sso/oidc/check"
                                        {:issuer-uri (mock-idp/issuer idp)
                                         :client-id  mock-idp/client-id})))))))))
