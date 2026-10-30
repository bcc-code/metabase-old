(ns metabase.sso.jwt
  "Verification of the JSON Web Tokens an identity provider sends back in Metabase's JWT single sign-on flow.

  The token must be signed with HS256, HS384 or HS512 using the shared secret (the `jwt-shared-secret` setting). It
  must carry an `iat` claim no more than [[max-token-age-seconds]] old, and when it carries `exp` or `nbf` those must
  hold; [[clock-skew-seconds]] of clock difference is allowed."
  (:require
   [buddy.sign.jws :as jws]
   [clojure.string :as str]
   [metabase.util.json :as json]
   [metabase.util.log :as log])
  (:import
   (java.nio.charset StandardCharsets)))

(set! *warn-on-reflection* true)

(def max-token-age-seconds
  "How old, in seconds, a token may be when it reaches Metabase. Identity providers send the user back with a freshly
  signed token, and a short window keeps a token that leaked from a URL from being replayed later."
  180)

(def clock-skew-seconds
  "How far apart, in seconds, Metabase's clock and the identity provider's may be."
  60)

(def ^:private allowed-algorithms
  #{:hs256 :hs384 :hs512})

(defn- invalid
  [error message]
  {:valid? false, :error error, :message message})

(defn validate-claims
  "Check the time claims of the string-keyed `claims` of a token whose signature is verified, at `now` (seconds since
  the epoch). Returns `{:valid? true, :claims claims}` or `{:valid? false, :error <keyword>, :message <string>}`."
  [claims now]
  (let [iat (get claims "iat")
        exp (get claims "exp")
        nbf (get claims "nbf")]
    (cond
      (not (map? claims))
      (invalid :malformed "The JWT payload is not a JSON object")

      (not (number? iat))
      (invalid :missing-iat "The JWT has no iat (issued at) claim")

      (> iat (+ now clock-skew-seconds))
      (invalid :not-yet-valid "The JWT was issued in the future")

      (> (- now iat) (+ max-token-age-seconds clock-skew-seconds))
      (invalid :too-old (format "The JWT was issued more than %d seconds ago" max-token-age-seconds))

      (and (some? exp) (not (number? exp)))
      (invalid :malformed "The JWT exp claim is not a number")

      (and (number? exp) (<= exp (- now clock-skew-seconds)))
      (invalid :expired "The JWT has expired")

      (and (number? nbf) (> nbf (+ now clock-skew-seconds)))
      (invalid :not-yet-valid "The JWT is not valid yet")

      :else
      {:valid? true, :claims claims})))

(defn verify-token
  "Verify `token` with `shared-secret`: its HMAC signature, then its time claims.

  Returns `{:valid? true, :claims <string-keyed claims>}` or `{:valid? false, :error <keyword>, :message <string>}`.
  `now` (seconds since the epoch) defaults to the system clock."
  ([token shared-secret]
   (verify-token token shared-secret (quot (System/currentTimeMillis) 1000)))
  ([token ^String shared-secret now]
   (try
     (let [{:keys [alg]} (jws/decode-header token)]
       (cond
         (str/blank? shared-secret)
         (invalid :not-configured "The JWT signing key is not set")

         (not (contains? allowed-algorithms alg))
         (invalid :unsupported-algorithm (format "Unsupported JWT signing algorithm %s; use HS256" (pr-str alg)))

         :else
         (let [payload (try
                         (jws/unsign token (.getBytes shared-secret StandardCharsets/UTF_8) {:alg alg})
                         (catch Exception e
                           (log/debugf "JWT signature did not verify: %s" (ex-message e))
                           nil))]
           (if (nil? payload)
             (invalid :invalid-signature "The JWT signature does not match the signing key")
             (validate-claims (json/decode (String. ^bytes payload StandardCharsets/UTF_8)) now)))))
     (catch Exception e
       (invalid :malformed (str "The JWT could not be read: " (ex-message e)))))))
