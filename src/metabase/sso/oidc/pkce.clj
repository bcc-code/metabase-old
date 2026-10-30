(ns metabase.sso.oidc.pkce
  "Proof Key for Code Exchange (RFC 7636) with the `S256` challenge method."
  (:import
   (java.nio.charset StandardCharsets)
   (java.security MessageDigest SecureRandom)
   (java.util Base64)))

(set! *warn-on-reflection* true)

(def ^:private ^SecureRandom secure-random
  (SecureRandom.))

(defn- base64url
  "`bs` base64url-encoded without padding."
  ^String [^bytes bs]
  (.encodeToString (.withoutPadding (Base64/getUrlEncoder)) bs))

(defn generate-code-verifier
  "A new random code verifier: 32 random bytes, base64url-encoded, which gives the 43 characters RFC 7636 asks for."
  []
  (let [bs (byte-array 32)]
    (.nextBytes secure-random bs)
    (base64url bs)))

(defn code-challenge
  "The `S256` code challenge for `verifier`: its SHA-256 hash, base64url-encoded without padding."
  [^String verifier]
  (base64url (.digest (MessageDigest/getInstance "SHA-256")
                      (.getBytes verifier StandardCharsets/US_ASCII))))
