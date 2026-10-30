(ns metabase.sso.auth-wrapper-test
  (:require
   [clojure.test :refer :all]
   [metabase.config.core :as config]
   [metabase.test :as mt]
   [metabase.test.fixtures :as fixtures]
   [metabase.test.http-client :as client]))

(use-fixtures
  :once
  (fixtures/initialize :web-server :test-users))

(deftest routes-test
  (when-not config/ee-available?
    (binding [client/*url-prefix* ""] ; prevent automatic /api/auth/sso which is a 404
      (testing "SAML is not available"
        ;; it's possible that a post or get is the actual route that doesn't exist. The warning handler is simple
        ;; and responds to any request with a helpful error message
        (is (= {:message "The auth/sso endpoint only exists in enterprise builds"
                :status "ee-build-required"}
               (mt/user-http-request :rasta :post 400 "api/saml"))))
      (testing "auth/sso is JWT single sign-on, which needs a token"
        (is (=? {:message #"Send the JWT.*"}
                (mt/user-http-request :rasta :post 400 "auth/sso")))))))
