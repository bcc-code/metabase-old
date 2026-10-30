import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { skipToken } from "metabase/api";
import { getUserIsAdmin } from "metabase/current-user";
import type { PLUGIN_REMOTE_SYNC } from "metabase/plugins";
import { useDispatch, useSelector } from "metabase/redux";
import { useSetting } from "metabase/settings";
import type { GitSyncStatus, GitSyncTask } from "metabase-types/api";

import {
  GIT_SYNC_CONTENT_TAGS,
  gitSyncApi,
  useGetGitSyncChangesQuery,
  useGetGitSyncStatusQuery,
} from "./api";
import { getIsGitSyncEnabled } from "./selectors";
import { RUNNING_TASK_POLLING_INTERVAL_MS, isTaskRunning } from "./utils";

type RemoteSyncDirtyState = ReturnType<
  (typeof PLUGIN_REMOTE_SYNC)["useRemoteSyncDirtyState"]
>;

/** Whether the current user can sync: an admin, with a repository connected. */
export const useCanUseGitSync = (): boolean => {
  const isAdmin = useSelector(getUserIsAdmin);
  const isEnabled = useSelector(getIsGitSyncEnabled);
  return isAdmin && isEnabled;
};

type GitSyncStatusResult = {
  status: GitSyncStatus | undefined;
  currentTask: GitSyncTask | null;
  isLoading: boolean;
  error: unknown;
};

/**
 * The Git sync status, checked every second or two while an export or import
 * runs. When one ends, the content it may have changed is refetched.
 * `status` is `undefined` for anyone who can't sync.
 */
export const useGitSyncStatus = (): GitSyncStatusResult => {
  const canUseGitSync = useCanUseGitSync();
  const dispatch = useDispatch();
  const [isPolling, setIsPolling] = useState(false);
  const { data, isLoading, error } = useGetGitSyncStatusQuery(
    canUseGitSync ? undefined : skipToken,
    { pollingInterval: isPolling ? RUNNING_TASK_POLLING_INTERVAL_MS : 0 },
  );
  const currentTask = data?.current_task ?? null;
  const isRunning = isTaskRunning(currentTask);
  const runningTaskIdRef = useRef<number | null>(null);

  useEffect(() => {
    setIsPolling(isRunning);
  }, [isRunning]);

  useEffect(() => {
    if (isRunning && currentTask) {
      runningTaskIdRef.current = currentTask.id;
    } else if (runningTaskIdRef.current != null) {
      runningTaskIdRef.current = null;
      dispatch(gitSyncApi.util.invalidateTags(GIT_SYNC_CONTENT_TAGS));
    }
  }, [isRunning, currentTask, dispatch]);

  return {
    status: canUseGitSync ? data : undefined,
    currentTask,
    isLoading,
    error,
  };
};

/** Whether to show Git sync controls, and the branch being synced. */
export const useGitSyncVisible = () => {
  const isVisible = useCanUseGitSync();
  const currentBranch = useSetting("remote-sync-branch");
  return { isVisible, currentBranch: isVisible ? currentBranch : null };
};

/**
 * The synced content changed on this instance since it last synced, for
 * admins. Everyone else gets an empty state.
 */
export const useRemoteSyncDirtyState = (): RemoteSyncDirtyState => {
  const canUseGitSync = useCanUseGitSync();
  const { data, isLoading, refetch } = useGetGitSyncChangesQuery(
    canUseGitSync ? undefined : skipToken,
  );

  const dirty = useMemo(() => data?.dirty ?? [], [data]);
  const changedCollections = useMemo(
    () => data?.changedCollections ?? {},
    [data],
  );

  const isCollectionDirty = useCallback(
    (collectionId: number | string | undefined) =>
      typeof collectionId === "number" &&
      changedCollections[collectionId] === true,
    [changedCollections],
  );

  const hasAnyCollectionDirty = useCallback(
    (collectionIds: Set<number> | number[]) =>
      Array.from(collectionIds).some((id) => changedCollections[id] === true),
    [changedCollections],
  );

  const hasDirtyInCollectionTree = useCallback(
    (collectionIds: Set<number>) =>
      dirty.some(
        (entity) =>
          (entity.model === "collection" && collectionIds.has(entity.id)) ||
          (entity.collection_id != null &&
            collectionIds.has(entity.collection_id)),
      ),
    [dirty],
  );

  return {
    dirty,
    changedCollections,
    isDirty: dirty.length > 0,
    isLoading,
    isCollectionDirty,
    hasAnyCollectionDirty,
    hasDirtyInCollectionTree,
    refetch,
  };
};

/** Whether a SQL snippet the last sync took along changed since. */
export const useHasSnippetsDirtyChanges = (): boolean => {
  const { dirty } = useRemoteSyncDirtyState();
  return dirty.some((entity) => entity.model === "nativequerysnippet");
};
