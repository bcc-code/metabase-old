(ns metabase.custom-viz.manifest-test
  (:require
   [clojure.string :as str]
   [clojure.test :refer :all]
   [metabase.custom-viz.manifest :as custom-viz.manifest]
   [metabase.util.json :as json]))

(defn- bundle-source
  "A bundle whose manifest is `manifest` (encoded as JSON) and whose code is `code`."
  ([manifest]
   (bundle-source manifest "window.MetabaseCustomViz.define(\"heron-ring\", {mount: function () { return {update: function () {}, unmount: function () {}}; }});"))
  ([manifest code]
   (str "/* metabase-custom-viz\n" (json/encode manifest) "\n*/\n" code)))

(def ^:private manifest
  {:apiVersion 1
   :identifier "heron-ring"
   :name       "Heron ring"
   :icon       "progress"
   :data       {:minRows 1 :maxRows 1 :requiredColumnTypes {:number 1}}
   :settings   [{:id "goal" :type "number" :title "Goal" :default 100}
                {:id "label" :type "text" :title "Label" :placeholder "Herons spotted"}
                {:id "shape" :type "select" :title "Shape" :options [{:name "Ring" :value "ring"}
                                                                     {:name "Bar" :value "bar"}]
                 :default "ring"}
                {:id "showGoal" :type "toggle" :title "Show goal" :default true}
                {:id "color" :type "color" :title "Color" :default "#509EE3"}
                {:id "value" :type "column" :title "Value" :columnType "number"}
                {:id "details" :type "columns" :title "Details"}]})

(defn- problem
  "The message `parse-bundle` throws for `source`, after checking it is a 400."
  [source]
  (try
    (custom-viz.manifest/parse-bundle source)
    nil
    (catch clojure.lang.ExceptionInfo e
      (is (= 400 (:status-code (ex-data e))))
      (ex-message e))))

(deftest ^:parallel manifest-text-test
  (testing "the manifest comment may follow whitespace and other comments"
    (is (= " {\"a\": 1} "
           (custom-viz.manifest/manifest-text "﻿\n/*! (c) Birds Inc. */\n// built by esbuild\n/* metabase-custom-viz {\"a\": 1} */ x();"))))
  (testing "a /*! comment keeps the manifest through minifiers"
    (is (= " {}" (custom-viz.manifest/manifest-text "/*! metabase-custom-viz {}*/"))))
  (testing "nil when code comes before the manifest comment"
    (is (nil? (custom-viz.manifest/manifest-text "\"use strict\"; /* metabase-custom-viz {} */"))))
  (testing "nil when the comment is a different one"
    (is (nil? (custom-viz.manifest/manifest-text "/* metabase-custom-vizzy {} */")))
    (is (nil? (custom-viz.manifest/manifest-text "/* metabase-custom-viz {}")))))

(deftest ^:parallel parse-bundle-test
  (let [source (bundle-source manifest)
        parsed (custom-viz.manifest/parse-bundle source)]
    (is (= manifest (:manifest parsed)))
    (is (= source (:bundle parsed)))
    (is (re-matches #"[0-9a-f]{64}" (:bundle_hash parsed)))
    (testing "the hash depends on the source only"
      (is (= (:bundle_hash parsed)
             (:bundle_hash (custom-viz.manifest/parse-bundle source))))
      (is (not= (:bundle_hash parsed)
                (:bundle_hash (custom-viz.manifest/parse-bundle (str source "\n")))))))
  (testing "the minimal manifest"
    (is (= {:apiVersion 1 :identifier "egret" :name "Egret"}
           (:manifest (custom-viz.manifest/parse-bundle
                       (bundle-source {:apiVersion 1 :identifier "egret" :name "Egret"})))))))

(deftest ^:parallel parse-bundle-rejects-invalid-bundles-test
  (are [source message] (= message (problem source))
    ""
    "The bundle is empty."

    "window.MetabaseCustomViz.define(\"egret\", {});"
    "The bundle must open with a \"/* metabase-custom-viz ... */\" comment holding its JSON manifest."

    "/* metabase-custom-viz [1, 2] */"
    "The manifest must be a JSON object."

    (bundle-source (dissoc manifest :apiVersion))
    "The manifest must declare an \"apiVersion\". This Metabase supports version 1."

    (bundle-source (assoc manifest :apiVersion 2))
    "The bundle was written for custom visualization API version 2, but this Metabase supports version 1."

    (bundle-source (assoc manifest :identifier "Heron Ring"))
    "The manifest is invalid: identifier: must be 1 to 64 lowercase letters, digits or hyphens, starting with a letter"

    (bundle-source (assoc manifest :data {:minRows 2 :maxRows 1}))
    "The manifest is invalid: data: minRows must not be greater than maxRows"

    (bundle-source (assoc manifest :settings [{:id "goal" :type "number" :title "Goal"}
                                              {:id "goal" :type "text" :title "Goal label"}]))
    "The manifest is invalid: settings: setting ids must be unique"

    (bundle-source (assoc manifest :settings [{:id "shape" :type "select" :title "Shape"
                                               :options [{:name "Ring" :value "ring"}] :default "bar"}
                                              {:id "kind" :type "slider" :title "Kind"}]))
    (str "The manifest is invalid: settings[0]: default must be the value of one of the options; "
         "settings[1].type: type must be one of text, number, select, toggle, color, column or columns")

    (bundle-source manifest "var heron = ;")
    "The bundle is not valid JavaScript: SyntaxError: bundle.js:4:12 Expected an operand but found ;")
  (testing "the manifest must be valid JSON"
    (is (str/starts-with? (problem "/* metabase-custom-viz {identifier: \"egret\"} */")
                          "The manifest is not valid JSON:")))
  (testing "a bundle must be a classic script, not an ES module"
    (is (str/starts-with? (problem (bundle-source manifest "import heron from \"heron\";"))
                          "The bundle is not valid JavaScript:")))
  (testing "closed manifests catch typos"
    (is (= "The manifest is invalid: nmae: disallowed key"
           (problem (bundle-source (assoc manifest :nmae "Heron")))))))

(deftest ^:parallel parse-bundle-size-limit-test
  (let [padding (apply str (repeat (inc custom-viz.manifest/max-bundle-bytes) " "))]
    (is (= "The bundle is larger than 5 MB."
           (problem (bundle-source manifest padding))))))

(deftest ^:parallel manifest-problem-test
  (is (nil? (custom-viz.manifest/manifest-problem manifest)))
  (is (= "The manifest must be a JSON object."
         (custom-viz.manifest/manifest-problem nil)))
  (is (= "The bundle was written for custom visualization API version 3, but this Metabase supports version 1."
         (custom-viz.manifest/manifest-problem (assoc manifest :apiVersion 3)))))

(deftest ^:parallel example-bundle-test
  (testing "the example plugin in the author guide is a valid bundle"
    (is (=? {:manifest {:apiVersion 1 :identifier "progress-ring" :name "Progress ring"}}
            (custom-viz.manifest/parse-bundle
             (slurp "frontend/src/metabase/fork/custom-viz/examples/progress-ring.js"))))))
