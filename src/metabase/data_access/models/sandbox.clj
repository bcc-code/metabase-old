(ns metabase.data-access.models.sandbox
  "Model definition for row and column security policies, a.k.a. sandboxes (historically \"group table access
  policies\", GTAPs). A sandbox restricts what one permissions group sees of one table: either the table filtered by
  user attributes, or the results of a saved question (optionally filtered by user attributes), which can also drop
  columns."
  (:require
   [metabase.data-access.validation :as data-access.validation]
   [metabase.lib.core :as lib]
   [metabase.lib.schema.parameter :as lib.schema.parameter]
   [metabase.util :as u]
   [metabase.util.json :as json]
   [metabase.util.log :as log]
   [methodical.core :as methodical]
   [toucan2.core :as t2]))

(set! *warn-on-reflection* true)

(methodical/defmethod t2/table-name :model/Sandbox [_model] :sandboxes)

(doto :model/Sandbox
  (derive :metabase/model))

(def ^:private invalid-target
  "Stands in for a remapping target that could not be read, so enforcement refuses to run the sandbox rather than
  silently dropping the restriction."
  [:invalid-target])

(defn normalize-attribute-remappings
  "Normalize `remappings` (attribute name -> parameter target, as JSON or as sent by the API) to string attribute names
  and MBQL parameter targets. A target that can't be normalized becomes `[:invalid-target]`."
  [remappings]
  (when (map? remappings)
    (into {}
          (map (fn [[attribute target]]
                 [(u/qualified-name attribute)
                  (try
                    (lib/normalize ::lib.schema.parameter/target target)
                    (catch Throwable e
                      (log/warnf e "Invalid sandbox attribute remapping target %s" (pr-str target))
                      invalid-target))]))
          remappings)))

(def ^:private transform-attribute-remappings
  {:in  (fn [remappings]
          (when (some? remappings)
            (json/encode remappings)))
   :out (fn [s]
          (cond
            (map? s)    (normalize-attribute-remappings s)
            (string? s) (try
                          (normalize-attribute-remappings (json/decode s))
                          (catch Throwable e
                            (log/error e "Failed to parse sandboxes.attribute_remappings")
                            ;; unreadable: keep a sentinel entry so enforcement throws instead of ignoring it
                            {"" invalid-target}))
            :else       nil))})

(t2/deftransforms :model/Sandbox
  {:attribute_remappings transform-attribute-remappings})

(t2/define-before-insert :model/Sandbox
  [sandbox]
  (data-access.validation/check-sandbox! sandbox)
  sandbox)

(t2/define-before-update :model/Sandbox
  [sandbox]
  (when (some #(contains? (t2/changes sandbox) %) [:table_id :card_id :attribute_remappings])
    (data-access.validation/check-sandbox! sandbox))
  sandbox)
