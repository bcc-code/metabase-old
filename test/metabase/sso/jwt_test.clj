(ns metabase.sso.jwt-test
  (:require
   [buddy.sign.jwt :as jwt]
   [clojure.test :refer :all]
   [metabase.sso.jwt :as sso.jwt]
   [metabase.util.json :as json]))

(set! *warn-on-reflection* true)

(def ^:private secret
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")

(def ^:private now 1800000000)

(defn- token
  ([claims] (token claims secret {:alg :hs256}))
  ([claims key opts] (jwt/sign claims key opts)))

(defn- unsigned-token
  "A token with the `none` algorithm and no signature."
  [claims]
  (let [encode #(-> (.withoutPadding (java.util.Base64/getUrlEncoder))
                    (.encodeToString (.getBytes ^String (json/encode %) "UTF-8")))]
    (str (encode {"alg" "none", "typ" "JWT"}) "." (encode claims) ".")))

(deftest ^:parallel verify-valid-token-test
  (doseq [alg [:hs256 :hs384 :hs512]]
    (testing alg
      (let [result (sso.jwt/verify-token (token {"email" "ada@example.com", "iat" now, "exp" (+ now 60)} secret {:alg alg})
                                         secret
                                         now)]
        (is (=? {:valid? true, :claims {"email" "ada@example.com"}} result))
        (testing "claims keep string keys, so namespaced claims survive"
          (is (=? {:valid? true, :claims {"https://example.com/roles" ["a"]}}
                  (sso.jwt/verify-token (token {"https://example.com/roles" ["a"], "iat" now}) secret now))))))))

(deftest ^:parallel verify-refuses-bad-tokens-test
  (are [error t] (= error (:error (sso.jwt/verify-token t secret now)))
    :invalid-signature     (token {"iat" now} "a-different-secret-a-different-secret!" {:alg :hs256})
    :unsupported-algorithm (unsigned-token {"iat" now})
    :missing-iat           (token {"email" "ada@example.com"})
    :too-old               (token {"iat" (- now sso.jwt/max-token-age-seconds sso.jwt/clock-skew-seconds 1)})
    :not-yet-valid         (token {"iat" (+ now sso.jwt/clock-skew-seconds 1)})
    :expired               (token {"iat" now, "exp" (- now sso.jwt/clock-skew-seconds)})
    :not-yet-valid         (token {"iat" now, "nbf" (+ now sso.jwt/clock-skew-seconds 1)})
    :malformed             "not-a-jwt")
  (testing "no secret means nothing verifies"
    (is (= :not-configured (:error (sso.jwt/verify-token (token {"iat" now}) nil now))))))

(deftest ^:parallel verify-allows-clock-skew-test
  (testing "tokens are accepted within the clock skew"
    (is (:valid? (sso.jwt/verify-token (token {"iat" (+ now sso.jwt/clock-skew-seconds)}) secret now)))
    (is (:valid? (sso.jwt/verify-token (token {"iat" now, "exp" (- now (dec sso.jwt/clock-skew-seconds))}) secret now)))
    (is (:valid? (sso.jwt/verify-token (token {"iat" (- now sso.jwt/max-token-age-seconds)}) secret now)))))
