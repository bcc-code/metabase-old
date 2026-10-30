import type {
  GitSyncChange,
  GitSyncCollection,
  GitSyncSettings,
  GitSyncStatus,
  GitSyncTask,
} from "metabase-types/api";

export const createMockGitSyncSettings = (
  opts?: Partial<GitSyncSettings>,
): GitSyncSettings => ({
  enabled: true,
  url: "https://git.example.com/org/metabase-content.git",
  branch: "main",
  token_set: true,
  type: "read-write",
  auto_import: false,
  auto_import_interval: 15,
  author_name: null,
  author_email: null,
  ...opts,
});

export const createMockGitSyncTask = (
  opts?: Partial<GitSyncTask>,
): GitSyncTask => ({
  id: 1,
  sync_task_type: "export",
  status: "successful",
  progress: 1,
  started_at: "2026-10-29T10:00:00Z",
  ended_at: "2026-10-29T10:00:05Z",
  last_progress_report_at: "2026-10-29T10:00:05Z",
  last_heartbeat_at: "2026-10-29T10:00:05Z",
  error_message: null,
  version: "0123456789abcdef0123456789abcdef01234567",
  outcome: { kind: "pushed", count: 2, branch: "main" },
  conflicts: [],
  initiated_by: 1,
  initiated_by_user: {
    id: 1,
    first_name: "Bobby",
    last_name: "Tables",
    email: "bobby@example.com",
  },
  ...opts,
});

export const createMockGitSyncStatus = (
  opts?: Partial<GitSyncStatus>,
): GitSyncStatus => ({
  enabled: true,
  url: "https://git.example.com/org/metabase-content.git",
  branch: "main",
  type: "read-write",
  auto_import: false,
  last_synced_commit: null,
  current_task: null,
  latest_task: null,
  last_import: null,
  last_export: null,
  ...opts,
});

export const createMockGitSyncChange = (
  opts?: Partial<GitSyncChange>,
): GitSyncChange => ({
  id: 1,
  name: "Orders",
  model: "card",
  collection_id: 1,
  display: "table",
  sync_status: "update",
  ...opts,
});

export const createMockGitSyncCollection = (
  opts?: Partial<GitSyncCollection>,
): GitSyncCollection => ({
  id: 1,
  name: "Sales",
  description: null,
  is_remote_synced: false,
  ...opts,
});
