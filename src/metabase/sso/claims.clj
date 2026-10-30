(ns metabase.sso.claims
  "Reading user details out of the claims an identity provider puts in a token or a userinfo response.

  A claim is named by a path, which may be a plain claim name (`email`), the full name of a namespaced claim
  (`https://example.com/claims/roles`, the shape of Auth0 custom claims), or a dotted path into nested claims
  (`realm_access.roles`). Claims maps here always have string keys, so that namespaced claim names survive intact."
  (:require
   [clojure.string :as str]
   [metabase.util :as u]
   [metabase.util.i18n :refer [tru]]))

(set! *warn-on-reflection* true)

(defn stringify-keys
  "`x` with the keys of every map in it, however deeply nested, turned into strings. Keyword keys keep their namespace,
  so a claim parsed into the keyword `:https:/example.com/roles` comes back as `\"https://example.com/roles\"`."
  [x]
  (cond
    (map? x)        (into {}
                          (map (fn [[k v]]
                                 [(if (keyword? k) (u/qualified-name k) (str k))
                                  (stringify-keys v)]))
                          x)
    (sequential? x) (mapv stringify-keys x)
    :else           x))

(defn- dot-indexes
  "The positions of the dots in `s`, first to last."
  [^String s]
  (keep-indexed (fn [i c] (when (= c \.) i)) s))

(defn claim-value
  "The value at `path` in the string-keyed `claims`, or nil when there is none.

  `path` is first looked up as a claim name, so a namespaced claim is found even though its name has dots in it.
  Otherwise each way of splitting it at a dot is tried, the shortest leading claim name first, and the rest of the path
  is looked up in that claim when it is an object."
  [claims path]
  (when (and (map? claims) (string? path) (not (str/blank? path)))
    (if (contains? claims path)
      (get claims path)
      (some (fn [i]
              (let [nested (get claims (subs path 0 i))]
                (when (map? nested)
                  (claim-value nested (subs path (inc i))))))
            (dot-indexes path)))))

(defn- scalar->string
  "`v` as a non-blank string when it is a string, number or boolean, otherwise nil."
  [v]
  (when (or (string? v) (number? v) (boolean? v))
    (not-empty (str/trim (str v)))))

(defn claim-string
  "The value at `path` in `claims` as a non-blank string, or nil when it is missing or not a single value."
  [claims path]
  (scalar->string (claim-value claims path)))

(defn claim-strings
  "The values at `path` in `claims` as a vector of strings, for claims such as groups or roles. A single value is
  treated as a list of one. Returns nil when the claim is missing, and an empty vector when it is present but empty, so
  callers can tell \"no groups\" from \"no groups claim\"."
  [claims path]
  (let [v (claim-value claims path)]
    (cond
      (nil? v)        nil
      (sequential? v) (into [] (keep scalar->string) v)
      :else           (into [] (keep scalar->string) [v]))))

;;; ------------------------------------------------ User attributes ------------------------------------------------

(defn parse-attribute-mappings
  "Parse `s`, the user attribute setting of an SSO provider, into a vector of `[attribute-name claim-path]` pairs.

  Entries are separated by commas or line breaks. An entry is either `name=claim` to store the claim at `claim` (any
  claim path) as the attribute `name`, or just `claim` to store it under the claim's own name. Throws a 400 for an
  attribute name that is blank, starts with `@` (reserved for tenant attributes), or appears twice."
  [s]
  (let [pairs (for [entry (str/split (or s "") #"[,\r\n]+")
                    :let  [entry (str/trim entry)]
                    :when (seq entry)]
                (let [[attribute claim] (if (str/includes? entry "=")
                                          (mapv str/trim (str/split entry #"=" 2))
                                          [entry entry])]
                  (when (or (str/blank? attribute) (str/blank? claim))
                    (throw (ex-info (tru "Each user attribute must look like name=claim or claim, but got \"{0}\"." entry)
                                    {:status-code 400})))
                  (when (str/starts-with? attribute "@")
                    (throw (ex-info (tru "User attribute names can''t start with @, but got \"{0}\"." attribute)
                                    {:status-code 400})))
                  [attribute claim]))]
    (when-let [duplicate (some (fn [[attribute n]] (when (> n 1) attribute))
                               (frequencies (map first pairs)))]
      (throw (ex-info (tru "The user attribute \"{0}\" is listed more than once." duplicate)
                      {:status-code 400})))
    (vec pairs)))

(defn- attribute-value
  "A claim value as a user attribute value: strings, numbers and booleans become strings; a list of them is joined with
  commas, in order; anything else (objects, lists containing objects, nulls) has no attribute value."
  [v]
  (cond
    (sequential? v) (let [values (map scalar->string v)]
                      (when (and (seq values) (every? some? values))
                        (str/join "," values)))
    :else           (scalar->string v)))

(defn claims->attributes
  "The user attributes that `mappings` (pairs from [[parse-attribute-mappings]]) pick out of the string-keyed `claims`,
  as a map of attribute names to string values. Claims that are missing, or whose value can't be an attribute, are
  left out."
  [claims mappings]
  (into {}
        (keep (fn [[attribute claim]]
                (when-some [value (attribute-value (claim-value claims claim))]
                  [attribute value])))
        mappings))
