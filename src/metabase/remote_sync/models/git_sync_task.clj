(ns metabase.remote-sync.models.git-sync-task
  "A Git sync export or import: who started it, how far it got and how it ended. Stored in the `remote_sync_task`
  table."
  (:require
   [metabase.models.interface :as mi]
   [methodical.core :as methodical]
   [toucan2.core :as t2]))

(methodical/defmethod t2/table-name :model/GitSyncTask [_model] :remote_sync_task)

(doto :model/GitSyncTask
  (derive :metabase/model))

(t2/deftransforms :model/GitSyncTask
  {:sync_task_type mi/transform-keyword
   :outcome        mi/transform-json
   :conflicts      mi/transform-json})
