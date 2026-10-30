(ns metabase.remote-sync.models.git-sync-entity
  "One synced entity as it was when this instance last matched the repository, after an export or an import: what
  its serialized form hashed to and where its file is. Comparing the content against these rows tells which entities
  changed locally since. Stored in the `remote_sync_object` table."
  (:require
   [methodical.core :as methodical]
   [toucan2.core :as t2]))

(methodical/defmethod t2/table-name :model/GitSyncEntity [_model] :remote_sync_object)

(doto :model/GitSyncEntity
  (derive :metabase/model))
