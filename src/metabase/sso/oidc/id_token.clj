(ns metabase.sso.oidc.id-token
  "Verification of OpenID Connect ID tokens, following OpenID Connect Core 1.0 section 3.1.3.7.

  The signature is checked against the provider's JWKS, fetched again once when no cached key verifies it so that keys
  the provider rotated in are picked up. RSA (RS*, PS*) and elliptic curve (ES*) signatures are accepted, as are HMAC
  (HS*) signatures keyed with the client secret, which some providers offer. The `iss`, `aud`, `azp`, `exp`, `iat`,
  `nbf`, `nonce` and `sub` claims are then checked, allowing for a little clock skew."
  (:require
   [buddy.core.keys :as buddy.keys]
   [buddy.sign.jws :as jws]
   [clojure.string :as str]
   [metabase.sso.oidc.tokens :as oidc.tokens]
   [metabase.util :as u]
   [metabase.util.json :as json]
   [metabase.util.log :as log])
  (:import
   (java.nio.charset StandardCharsets)))

(set! *warn-on-reflection* true)

(def clock-skew-seconds
  "How far apart, in seconds, Metabase's clock and the identity provider's may be when checking the time claims."
  120)

(def ^:private asymmetric-algorithms
  #{:rs256 :rs384 :rs512 :ps256 :ps384 :ps512 :es256 :es384 :es512})

(def ^:private hmac-algorithms
  #{:hs256 :hs384 :hs512})

(defn- key-type
  "The JWK `kty` of the keys that can verify signatures made with `alg`."
  [alg]
  (if (contains? #{:es256 :es384 :es512} alg) "EC" "RSA"))

(defn- matching-keys
  "The keys of `jwks` that may have signed a token with the header `alg` and `kid`: signing keys of the right type,
  with that key ID when the token names one, and that declare no algorithm or `alg`."
  [alg kid jwks]
  (filter (fn [jwk]
            (and (or (nil? kid) (= kid (:kid jwk)))
                 (contains? #{nil "sig"} (:use jwk))
                 (= (key-type alg) (:kty jwk))
                 (or (nil? (:alg jwk))
                     (= (name alg) (u/lower-case-en (str (:alg jwk)))))))
          (:keys jwks)))

(defn- unsign-with-keys
  "The payload of `token` if one of `jwks` verifies its `alg` signature, otherwise nil."
  [token alg jwks]
  (some (fn [jwk]
          (try
            (jws/unsign token (buddy.keys/jwk->public-key jwk) {:alg alg})
            (catch Exception e
              (log/debugf "ID token signature did not verify with key %s: %s" (:kid jwk) (ex-message e))
              nil)))
        jwks))

(defn- unsign-with-jwks
  "The payload of `token` if a key from the JWKS at `jwks-uri` verifies it. When none of the cached keys does, the JWKS
  is fetched again once, as the provider may have rotated its keys since they were cached."
  [token alg kid jwks-uri]
  (let [attempt (fn []
                  (some->> (oidc.tokens/get-jwks jwks-uri)
                           (matching-keys alg kid)
                           seq
                           (unsign-with-keys token alg)))]
    (or (attempt)
        (do
          (log/infof "No cached key from %s verifies the ID token (kid %s); fetching the JWKS again" jwks-uri kid)
          (oidc.tokens/invalidate-jwks-cache! jwks-uri)
          (attempt)))))

(defn- unsign-with-secret
  "The payload of `token` if its HMAC `alg` signature verifies with `client-secret`, otherwise nil."
  [token alg ^String client-secret]
  (try
    (jws/unsign token (.getBytes client-secret StandardCharsets/UTF_8) {:alg alg})
    (catch Exception e
      (log/debugf "ID token HMAC signature did not verify: %s" (ex-message e))
      nil)))

(defn- invalid
  [error message]
  {:valid? false, :error error, :message message})

(defn validate-claims
  "Check the string-keyed `claims` of an ID token whose signature is already verified.

  Options:
  - `:issuer`    - the issuer the provider's discovery document declares; `iss` must equal it exactly
  - `:client-id` - must be one of the `aud` values, and the `azp` when there is one or several audiences
  - `:nonce`     - when given, `nonce` must equal it
  - `:now`       - the current time in seconds since the epoch (defaults to the system clock)

  Returns `{:valid? true, :claims claims}` or `{:valid? false, :error <keyword>, :message <string>}`."
  [claims {:keys [issuer client-id nonce now]}]
  (let [now       (or now (quot (System/currentTimeMillis) 1000))
        aud       (get claims "aud")
        audiences (if (string? aud) [aud] aud)
        azp       (get claims "azp")
        exp       (get claims "exp")
        iat       (get claims "iat")
        nbf       (get claims "nbf")
        sub       (get claims "sub")]
    (cond
      (not (map? claims))
      (invalid :malformed "The ID token payload is not a JSON object")

      (not= issuer (get claims "iss"))
      (invalid :invalid-issuer (format "The ID token issuer %s does not match the provider's issuer %s"
                                       (pr-str (get claims "iss")) (pr-str issuer)))

      (not (and (sequential? audiences) (some #{client-id} audiences)))
      (invalid :invalid-audience (format "The ID token audience %s does not include the client ID %s"
                                         (pr-str aud) (pr-str client-id)))

      (or (and (some? azp) (not= azp client-id))
          (and (nil? azp) (> (count audiences) 1)))
      (invalid :invalid-audience (format "The ID token authorized party %s is not the client ID %s"
                                         (pr-str azp) (pr-str client-id)))

      (not (number? exp))
      (invalid :malformed "The ID token has no exp claim")

      (<= exp (- now clock-skew-seconds))
      (invalid :expired "The ID token has expired")

      (not (number? iat))
      (invalid :malformed "The ID token has no iat claim")

      (> iat (+ now clock-skew-seconds))
      (invalid :not-yet-valid "The ID token was issued in the future")

      (and (number? nbf) (> nbf (+ now clock-skew-seconds)))
      (invalid :not-yet-valid "The ID token is not valid yet")

      (and (some? nonce) (not= nonce (get claims "nonce")))
      (invalid :invalid-nonce "The ID token nonce does not match the one sent with the authorization request")

      (not (and (string? sub) (not (str/blank? sub))))
      (invalid :malformed "The ID token has no sub claim")

      :else
      {:valid? true, :claims claims})))

(defn verify
  "Verify the ID token `token`: its signature, then its claims (see [[validate-claims]] for `options`, which here also
  take `:jwks-uri` and `:client-secret`).

  Returns `{:valid? true, :claims <string-keyed claims>}` or `{:valid? false, :error <keyword>, :message <string>}`."
  [token {:keys [jwks-uri client-secret] :as options}]
  (try
    (let [{:keys [alg kid]} (jws/decode-header token)
          payload           (cond
                              (contains? asymmetric-algorithms alg)
                              (unsign-with-jwks token alg kid jwks-uri)

                              (and (contains? hmac-algorithms alg) (not (str/blank? client-secret)))
                              (unsign-with-secret token alg client-secret)

                              :else
                              ::unsupported-algorithm)]
      (cond
        (= payload ::unsupported-algorithm)
        (invalid :unsupported-algorithm (format "Unsupported ID token signing algorithm %s" (pr-str alg)))

        (nil? payload)
        (invalid :invalid-signature "The ID token signature could not be verified")

        :else
        (validate-claims (json/decode (String. ^bytes payload StandardCharsets/UTF_8)) options)))
    (catch Exception e
      (invalid :malformed (str "The ID token could not be read: " (ex-message e))))))
