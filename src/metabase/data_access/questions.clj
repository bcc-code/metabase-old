(ns metabase.data-access.questions
  "Keeping saved questions used by row and column security policies valid."
  (:require
   [metabase.data-access.db :as data-access.db]
   [metabase.data-access.validation :as data-access.validation]
   [metabase.util.i18n :refer [tru]]))

(set! *warn-on-reflection* true)

(defn pre-update-check-sandbox-constraints
  "Before the question `card` is updated with `changes`: when sandboxes use it and its query changes, throw a 400 unless
  the new query still suits each of them (returns only columns of the sandboxed table, keeps the variables attributes
  are remapped onto)."
  [{card-id :id :as _card} changes]
  (when (and card-id (contains? changes :dataset_query))
    (doseq [sandbox (data-access.db/sandboxes-using-card card-id)]
      (try
        (data-access.validation/check-sandbox! sandbox (select-keys changes [:dataset_query :result_metadata]))
        (catch clojure.lang.ExceptionInfo e
          (throw (ex-info (tru "This question is used by row and column security, and the change would break it: {0}"
                               (ex-message e))
                          {:status-code 400, :sandbox-id (:id sandbox)}
                          e)))))))

(defn pre-delete-check-sandbox-constraints
  "Before the question `card` is deleted: throw a 400 when a sandbox uses it. Deleting it would delete the sandbox too,
  and with it the restriction, giving the sandboxed groups unrestricted access to the table."
  [{card-id :id :as _card}]
  (when (and card-id (seq (data-access.db/sandboxes-using-card card-id)))
    (throw (ex-info (tru "This question is used by row and column security. Remove it from the row and column security settings before deleting it.")
                    {:status-code 400, :card-id card-id}))))
