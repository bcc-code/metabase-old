(ns metabase.sso.oidc.id-token-test
  (:require
   [buddy.core.keys :as buddy.keys]
   [buddy.sign.jwt :as jwt]
   [clj-http.client :as http]
   [clojure.test :refer :all]
   [metabase.sso.oidc.id-token :as oidc.id-token]
   [metabase.sso.oidc.tokens :as oidc.tokens]
   [metabase.test :as mt]
   [metabase.util.json :as json])
  (:import
   (java.security KeyPair KeyPairGenerator)
   (java.security.spec ECGenParameterSpec)))

(set! *warn-on-reflection* true)

(defn- rsa-key-pair ^KeyPair []
  (.generateKeyPair (doto (KeyPairGenerator/getInstance "RSA") (.initialize 2048))))

(defn- ec-key-pair ^KeyPair []
  (.generateKeyPair (doto (KeyPairGenerator/getInstance "EC") (.initialize (ECGenParameterSpec. "secp256r1")))))

(def ^:private rsa-1 (delay (rsa-key-pair)))
(def ^:private rsa-2 (delay (rsa-key-pair)))
(def ^:private ec (delay (ec-key-pair)))

(defn- jwk [^KeyPair key-pair kid]
  (merge (buddy.keys/public-key->jwk (.getPublic key-pair)) {:kid kid, :use "sig"}))

(def ^:private issuer "https://login.example.com/")
(def ^:private client-id "client-123")
(def ^:private client-secret "the-client-secret-the-client-secret")
(def ^:private jwks-uri "https://login.example.com/.well-known/jwks.json")
(def ^:private now 1800000000)

(defn- claims [& {:as overrides}]
  (merge {"iss" issuer, "aud" client-id, "sub" "auth0|123", "exp" (+ now 300), "iat" now, "nonce" "the-nonce"}
         overrides))

(defn- sign [claims ^KeyPair key-pair alg kid]
  (jwt/sign claims (.getPrivate key-pair) {:alg alg, :header {:kid kid}}))

(defn- unsigned-token
  "A token with the `none` algorithm and no signature."
  [claims]
  (let [encode #(-> (.withoutPadding (java.util.Base64/getUrlEncoder))
                    (.encodeToString (.getBytes ^String (json/encode %) "UTF-8")))]
    (str (encode {"alg" "none", "typ" "JWT"}) "." (encode claims) ".")))

(defn- options [& {:as overrides}]
  (merge {:jwks-uri jwks-uri, :issuer issuer, :client-id client-id, :client-secret client-secret,
          :nonce "the-nonce", :now now}
         overrides))

(defn- do-with-jwks!
  "Call `f` with the JWKS served from `jwks-fn` (called on every fetch); `f` gets an atom counting the fetches."
  [jwks-fn f]
  (let [fetches (atom 0)]
    (oidc.tokens/clear-jwks-cache!)
    (mt/with-dynamic-fn-redefs [http/get (fn [url _opts]
                                           (is (= jwks-uri url))
                                           (swap! fetches inc)
                                           {:status 200, :body (jwks-fn)})]
      (f fetches))))

(deftest verify-signature-algorithms-test
  (do-with-jwks!
   (fn [] {:keys [(jwk @rsa-1 "rsa-1") (jwk @ec "ec-1")]})
   (fn [_fetches]
    (doseq [[alg key-pair kid] [[:rs256 @rsa-1 "rsa-1"]
                                [:ps256 @rsa-1 "rsa-1"]
                                [:rs512 @rsa-1 "rsa-1"]
                                [:es256 @ec "ec-1"]]]
      (testing alg
        (is (=? {:valid? true, :claims {"sub" "auth0|123", "iss" issuer}}
                (oidc.id-token/verify (sign (claims) key-pair alg kid) (options))))))
    (testing "HS256 is keyed with the client secret"
      (is (=? {:valid? true}
              (oidc.id-token/verify (jwt/sign (claims) client-secret {:alg :hs256}) (options))))
      (is (=? {:valid? false, :error :invalid-signature}
              (oidc.id-token/verify (jwt/sign (claims) "some-other-secret-some-other-secret" {:alg :hs256})
                                    (options)))))
    (testing "unsigned tokens are refused"
      (is (=? {:valid? false, :error :unsupported-algorithm}
              (oidc.id-token/verify (unsigned-token (claims)) (options)))))
    (testing "a token signed by a key the provider does not publish is refused"
      (is (=? {:valid? false, :error :invalid-signature}
              (oidc.id-token/verify (sign (claims) @rsa-2 :rs256 "rsa-1") (options))))))))

(deftest verify-picks-up-rotated-keys-test
  (testing "a token signed with a key added after the JWKS was cached verifies after one refetch"
    (let [published (atom [(jwk @rsa-1 "rsa-1")])]
      (do-with-jwks!
       (fn [] {:keys @published})
       (fn [fetches]
        (is (:valid? (oidc.id-token/verify (sign (claims) @rsa-1 :rs256 "rsa-1") (options))))
        (is (= 1 @fetches))
        (testing "the cached JWKS serves the next verification"
          (is (:valid? (oidc.id-token/verify (sign (claims) @rsa-1 :rs256 "rsa-1") (options))))
          (is (= 1 @fetches)))
        (swap! published conj (jwk @rsa-2 "rsa-2"))
        (is (:valid? (oidc.id-token/verify (sign (claims) @rsa-2 :rs256 "rsa-2") (options))))
        (is (= 2 @fetches)))))))

(deftest validate-claims-test
  (are [error claims options] (= error (:error (oidc.id-token/validate-claims claims options)))
    :invalid-issuer   (claims "iss" "https://login.example.com") (options)
    :invalid-audience (claims "aud" "another-client") (options)
    :invalid-audience (claims "aud" ["another-client" client-id]) (options)
    :invalid-audience (claims "azp" "another-client") (options)
    :expired          (claims "exp" (- now oidc.id-token/clock-skew-seconds)) (options)
    :malformed        (dissoc (claims) "exp") (options)
    :malformed        (dissoc (claims) "iat") (options)
    :not-yet-valid    (claims "iat" (+ now oidc.id-token/clock-skew-seconds 1)) (options)
    :not-yet-valid    (claims "nbf" (+ now oidc.id-token/clock-skew-seconds 1)) (options)
    :invalid-nonce    (claims "nonce" "replayed") (options)
    :invalid-nonce    (dissoc (claims) "nonce") (options)
    :malformed        (dissoc (claims) "sub") (options))
  (testing "valid claims"
    (are [claims] (:valid? (oidc.id-token/validate-claims claims (options)))
      (claims)
      (claims "aud" [client-id])
      (claims "aud" [client-id "https://api.example.com"] "azp" client-id)
      (claims "exp" (- now (dec oidc.id-token/clock-skew-seconds)))
      (claims "iat" (+ now oidc.id-token/clock-skew-seconds)))))
