(ns metabase.sso.api.jwt-test
  (:require
   [clojure.test :refer :all]
   [metabase.settings.core :as setting]
   [metabase.sso.settings :as sso.settings]
   [metabase.test :as mt]))

(set! *warn-on-reflection* true)

(def ^:private shared-secret
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")

(defmacro ^:private with-clean-jwt-settings! [& body]
  `(mt/with-temporary-setting-values [jwt-enabled               false
                                      jwt-identity-provider-uri nil
                                      jwt-shared-secret         nil
                                      jwt-user-attributes       nil]
     ~@body))

(deftest permissions-test
  (is (= "You don't have permissions to do that."
         (mt/user-http-request :rasta :put 403 "sso/jwt/settings" {:jwt-enabled false}))))

(deftest save-settings-test
  (with-clean-jwt-settings!
    (testing "JWT can't be enabled before it is configured"
      (is (re-find #"not configured"
                   (mt/user-http-request :crowberto :put 400 "sso/jwt/settings" {:jwt-enabled true})))
      (is (not (sso.settings/jwt-enabled))))
    (testing "saving the settings and enabling in one request"
      (is (= {:jwt-enabled true}
             (mt/user-http-request :crowberto :put 200 "sso/jwt/settings"
                                   {:jwt-identity-provider-uri "https://idp.example.com/login"
                                    :jwt-shared-secret         shared-secret
                                    :jwt-user-attributes       "department, org_id=org.id"
                                    :jwt-enabled               true})))
      (is (sso.settings/jwt-enabled))
      (is (= "department, org_id=org.id" (sso.settings/jwt-user-attributes))))
    (testing "the signing key is masked when read, and saving the masked value keeps it"
      (mt/user-http-request :crowberto :put 200 "sso/jwt/settings"
                            {:jwt-shared-secret (setting/user-facing-value :jwt-shared-secret)})
      (is (= shared-secret (sso.settings/jwt-shared-secret))))
    (testing "invalid values are refused"
      (is (re-find #"at least 32 characters"
                   (mt/user-http-request :crowberto :put 400 "sso/jwt/settings" {:jwt-shared-secret "too-short"})))
      (is (re-find #"must be an absolute URL"
                   (mt/user-http-request :crowberto :put 400 "sso/jwt/settings"
                                         {:jwt-identity-provider-uri "javascript:alert(1)"})))
      (is (re-find #"can't start with @"
                   (mt/user-http-request :crowberto :put 400 "sso/jwt/settings" {:jwt-user-attributes "@tenant"}))))
    (testing "turning JWT off"
      (is (= {:jwt-enabled false}
             (mt/user-http-request :crowberto :put 200 "sso/jwt/settings" {:jwt-enabled false}))))))
