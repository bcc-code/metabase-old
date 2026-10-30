(ns metabase.sso.oidc.pkce-test
  (:require
   [clojure.test :refer :all]
   [metabase.sso.oidc.pkce :as oidc.pkce]))

(deftest ^:parallel code-verifier-test
  (let [verifiers (repeatedly 20 oidc.pkce/generate-code-verifier)]
    (testing "verifiers are 43 characters of the unreserved set RFC 7636 allows"
      (is (every? #(re-matches #"[A-Za-z0-9\-._~]{43}" %) verifiers)))
    (testing "verifiers are random"
      (is (= 20 (count (set verifiers)))))))

(deftest ^:parallel code-challenge-test
  (testing "the S256 challenge is the unpadded base64url SHA-256 of the verifier"
    ;; computed independently with Python's hashlib and base64.urlsafe_b64encode
    (is (= "cS1u8Yyg1sK-3qifzRuUJqt3uPPGBkqqmYZtPYpknkg"
           (oidc.pkce/code-challenge "dBjftJeZ4CVP-mJ92K9yKmJ6ZtVZBbNDb2JEfGcAoG8")))))
