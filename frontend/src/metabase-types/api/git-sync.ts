import type { RemoteSyncEntityModel } from "./remote-sync";
import type { UserId } from "./user";

/** How an instance syncs with the repository. */
export type GitSyncType = "read-write" | "read-only";

/** The Git sync settings as `GET /api/remote-sync/settings` returns them. */
export type GitSyncSettings = {
  enabled: boolean;
  url: string | null;
  branch: string;
  /** Whether an access token is saved; the token itself is never returned. */
  token_set: boolean;
  type: GitSyncType;
  auto_import: boolean;
  /** Minutes between scheduled imports. */
  auto_import_interval: number;
  author_name: string | null;
  author_email: string | null;
};

export type UpdateGitSyncSettingsRequest = {
  url: string;
  branch: string;
  /** Omit to keep the saved token, `""` to remove it. */
  token?: string;
  type?: GitSyncType;
  auto_import?: boolean;
  auto_import_interval?: number;
  author_name?: string | null;
  author_email?: string | null;
};

export type GitSyncConnectionCheck = {
  branches: string[];
  branch_exists: boolean;
};

export type UpdateGitSyncSettingsResponse = GitSyncConnectionCheck & {
  settings: GitSyncSettings;
};

export type TestGitSyncConnectionRequest = {
  url: string;
  branch?: string;
  /** Omit to use the saved token. */
  token?: string;
};

export type GitSyncTaskType = "import" | "export";

export type GitSyncTaskStatus =
  | "running"
  | "successful"
  | "conflict"
  | "errored"
  | "timed-out"
  | "cancelled";

export type GitSyncTaskOutcomeKind =
  | "pushed"
  | "push-skipped"
  | "pulled"
  | "pull-skipped"
  | "remote-changed"
  | "local-changes";

export type GitSyncTaskOutcome = {
  kind: GitSyncTaskOutcomeKind;
  count?: number;
  branch?: string;
};

export type GitSyncTaskUser = {
  id: UserId;
  first_name: string | null;
  last_name: string | null;
  email: string;
};

/** An export or import, running or ended. */
export type GitSyncTask = {
  id: number;
  sync_task_type: GitSyncTaskType;
  status: GitSyncTaskStatus;
  /** From 0 to 1. */
  progress: number | null;
  started_at: string | null;
  ended_at: string | null;
  last_progress_report_at: string | null;
  last_heartbeat_at: string | null;
  error_message: string | null;
  /** The commit the task ended on. */
  version: string | null;
  outcome: GitSyncTaskOutcome | null;
  /** What a task that stopped with a conflict would have overwritten. */
  conflicts: string[];
  /** Null for a scheduled import. */
  initiated_by: UserId | null;
  initiated_by_user: GitSyncTaskUser | null;
};

export type GitSyncStatus = {
  enabled: boolean;
  url: string | null;
  branch: string;
  type: GitSyncType;
  auto_import: boolean;
  last_synced_commit: string | null;
  current_task: GitSyncTask | null;
  latest_task: GitSyncTask | null;
  last_import: GitSyncTask | null;
  last_export: GitSyncTask | null;
};

export type GitSyncChangeStatus = "create" | "update" | "delete";

/** A synced entity changed on this instance since it last synced. */
export type GitSyncChange = {
  id: number;
  name: string | null;
  model: RemoteSyncEntityModel;
  collection_id: number | null;
  display: string | null;
  sync_status: GitSyncChangeStatus;
};

export type GitSyncChangesResponse = {
  dirty: GitSyncChange[];
  changed_collections: Record<number, boolean>;
};

export type ExportGitSyncRequest = {
  message?: string;
  /** Overwrite changes the branch got since this instance last synced. */
  force?: boolean;
};

export type ImportGitSyncRequest = {
  /** Discard the synced content changed on this instance since it last synced. */
  force?: boolean;
};

/** A top-level collection that can be synced. */
export type GitSyncCollection = {
  id: number;
  name: string;
  description: string | null;
  is_remote_synced: boolean;
};

export type UpdateGitSyncCollectionRequest = {
  id: number;
  synced: boolean;
};
