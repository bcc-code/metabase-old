import type { PLUGIN_REMOTE_SYNC } from "metabase/plugins";

import { GitSyncTaskStatus } from "./components/GitSyncTaskStatus";
import { useGitSyncStatus } from "./hooks";
import { getRunningTaskMessage, isTaskRunning } from "./utils";

type SyncStatus = ReturnType<(typeof PLUGIN_REMOTE_SYNC)["useSyncStatus"]>;

/**
 * The export or import running now, with a floating card showing its
 * progress. Idle for anyone who can't sync.
 */
export const useSyncStatus = (): SyncStatus => {
  const { currentTask } = useGitSyncStatus();

  if (!currentTask || !isTaskRunning(currentTask)) {
    return {
      isIdle: true,
      taskType: null,
      progress: 0,
      message: "",
      progressModal: null,
    };
  }

  return {
    isIdle: false,
    taskType: currentTask.sync_task_type,
    progress: currentTask.progress ?? 0,
    message: getRunningTaskMessage(currentTask),
    progressModal: <GitSyncTaskStatus task={currentTask} />,
  };
};
