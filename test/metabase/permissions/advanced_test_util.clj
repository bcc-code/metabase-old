(ns metabase.permissions.advanced-test-util
  "Helpers for testing the permissions that come with the `advanced-permissions` feature."
  (:require
   [metabase.premium-features.settings :as premium-features.settings]
   [metabase.premium-features.test-util :as premium-features.test-util]
   [metabase.test.util.dynamic-redefs :as dynamic-redefs]))

(defmacro with-advanced-permissions
  "Run `body` with the `advanced-permissions` feature enabled, whether or not this build provides it on its own."
  [& body]
  `(premium-features.test-util/with-additional-premium-features #{:advanced-permissions}
     (dynamic-redefs/with-dynamic-fn-redefs [premium-features.settings/enable-advanced-permissions? (constantly true)]
       ~@body)))

(defmacro without-advanced-permissions
  "Run `body` with the `advanced-permissions` feature disabled, whether or not this build provides it on its own."
  [& body]
  `(premium-features.test-util/with-premium-features #{}
     (dynamic-redefs/with-dynamic-fn-redefs [premium-features.settings/enable-advanced-permissions? (constantly false)]
       ~@body)))
