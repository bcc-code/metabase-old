(ns metabase.custom-viz.manifest
  "Parsing and validating custom visualization bundles.

  A bundle is a single JavaScript file (a classic script, no `import`/`export`) that opens with a comment holding its
  JSON manifest:

      /* metabase-custom-viz
      {\"apiVersion\": 1, \"identifier\": \"progress-ring\", \"name\": \"Progress ring\"}
      */

  Only whitespace and other comments may precede it; a `/*!` comment also works, so minifiers keep it."
  (:require
   [buddy.core.codecs :as codecs]
   [buddy.core.hash :as buddy-hash]
   [clojure.string :as str]
   [malli.error :as me]
   [metabase.custom-viz.schema :as custom-viz.schema]
   [metabase.util.i18n :refer [tru]]
   [metabase.util.json :as json]
   [metabase.util.log :as log]
   [metabase.util.malli :as mu]
   [metabase.util.malli.registry :as mr])
  (:import
   (java.util.function Predicate)
   (org.graalvm.polyglot Context Engine HostAccess PolyglotException Source)
   (org.graalvm.polyglot.io IOAccess)))

(set! *warn-on-reflection* true)

(def max-bundle-bytes
  "The largest bundle, in bytes, that can be installed."
  (* 5 1024 1024))

(defn- invalid-bundle
  "An exception for an invalid bundle, answered with a 400 and `message` as the body."
  [message]
  (ex-info message {:status-code 400}))

(defn- skip-line-comment
  [^String s]
  (if-let [newline-index (str/index-of s "\n")]
    (subs s (inc newline-index))
    ""))

(defn manifest-text
  "The text inside the `metabase-custom-viz` comment that opens `source`, after the marker, or nil when `source`
  does not open with one."
  [^String source]
  (loop [s (str/triml (str/replace-first source #"^﻿" ""))]
    (cond
      (str/starts-with? s "//")
      (recur (str/triml (skip-line-comment s)))

      (str/starts-with? s "/*")
      (when-let [end (str/index-of s "*/" 2)]
        (if-let [[_ text] (re-matches #"(?s)!?\s*metabase-custom-viz(?![\w-])(.*)" (subs s 2 end))]
          text
          (recur (str/triml (subs s (+ end 2))))))

      :else
      nil)))

(defn- error-lines
  "Flatten humanized Malli `errors` into `path: message` lines."
  [path errors]
  (letfn [(path-str []
            (reduce (fn [acc k]
                      (if (keyword? k)
                        (str acc (when (seq acc) ".") (name k))
                        (str acc "[" k "]")))
                    ""
                    path))
          (line [messages]
            (let [messages (str/join ", " messages)]
              (if (seq path)
                (str (path-str) ": " messages)
                messages)))]
    (cond
      (map? errors)
      (mapcat (fn [[k v]] (error-lines (conj path k) v)) errors)

      (and (sequential? errors) (every? string? errors))
      [(line errors)]

      (sequential? errors)
      (mapcat (fn [i v] (when v (error-lines (conj path i) v))) (range) errors)

      (string? errors)
      [(line [errors])]

      :else
      [])))

(defn manifest-problem
  "A description of why `manifest` (keywordized) is not a manifest this Metabase can run, or nil when it is valid."
  [manifest]
  (cond
    (not (map? manifest))
    (tru "The manifest must be a JSON object.")

    (not (contains? manifest :apiVersion))
    (tru "The manifest must declare an \"apiVersion\". This Metabase supports version {0}."
         (str/join ", " (sort custom-viz.schema/supported-api-versions)))

    (not (contains? custom-viz.schema/supported-api-versions (:apiVersion manifest)))
    (tru "The bundle was written for custom visualization API version {0}, but this Metabase supports version {1}."
         (pr-str (:apiVersion manifest))
         (str/join ", " (sort custom-viz.schema/supported-api-versions)))

    :else
    (when-let [explanation (mr/explain ::custom-viz.schema/manifest manifest)]
      (tru "The manifest is invalid: {0}"
           (str/join "; " (error-lines [] (me/humanize explanation)))))))

(defn- parse-manifest
  "The keywordized manifest of `source`. Throws a 400 when it is missing or is not valid JSON."
  [source]
  (let [text (or (manifest-text source)
                 (throw (invalid-bundle
                         (tru "The bundle must open with a \"/* metabase-custom-viz ... */\" comment holding its JSON manifest."))))]
    (try
      (json/decode-document+kw (str/trim text))
      (catch Exception e
        (throw (invalid-bundle (tru "The manifest is not valid JSON: {0}" (ex-message e))))))))

(def ^:private no-host-class-lookup
  (reify Predicate
    (test [_ _] false)))

(defn syntax-error
  "The message of the syntax error in the JavaScript `source`, parsed (never run) as a classic script, or nil when it
  parses. Returns nil, after logging, when the JavaScript engine is unavailable."
  [^String source]
  (try
    (with-open [^Engine engine   (.. (Engine/newBuilder)
                                     (option "engine.WarnInterpreterOnly" "false")
                                     (build))
                ^Context context (.. (Context/newBuilder (into-array String ["js"]))
                                     (engine engine)
                                     (allowHostAccess HostAccess/NONE)
                                     (allowHostClassLookup no-host-class-lookup)
                                     (allowIO IOAccess/NONE)
                                     (build))]
      (try
        (.parse context (.build (Source/newBuilder "js" source "bundle.js")))
        nil
        (catch PolyglotException e
          (if (.isSyntaxError e)
            (first (str/split-lines (ex-message e)))
            (throw e)))))
    (catch Throwable e
      (log/warn e "Could not check the syntax of a custom visualization bundle")
      nil)))

(defn bundle-hash
  "The SHA-256 hex digest of the UTF-8 encoded `source`."
  [^String source]
  (codecs/bytes->hex (buddy-hash/sha256 source)))

(mu/defn parse-bundle :- ::custom-viz.schema/parsed-bundle
  "Validate the JavaScript `source` of a bundle and return it with its manifest and hash. Throws a 400 whose message
  says what is wrong when the bundle is empty, too large, has no valid manifest, or is not valid JavaScript."
  [source :- :string]
  (when (str/blank? source)
    (throw (invalid-bundle (tru "The bundle is empty."))))
  (when (> (count (.getBytes ^String source "UTF-8")) max-bundle-bytes)
    (throw (invalid-bundle (tru "The bundle is larger than {0} MB." (quot max-bundle-bytes (* 1024 1024))))))
  (let [manifest (parse-manifest source)]
    (when-let [problem (manifest-problem manifest)]
      (throw (invalid-bundle problem)))
    (when-let [message (syntax-error source)]
      (throw (invalid-bundle (tru "The bundle is not valid JavaScript: {0}" message))))
    {:manifest    manifest
     :bundle      source
     :bundle_hash (bundle-hash source)}))
