import { match } from "ts-pattern";
import { msgid, ngettext, t } from "ttag";

import type {
  GitSyncTask,
  GitSyncTaskUser,
  IconName,
  RemoteSyncEntityModel,
  RemoteSyncEntityStatus,
} from "metabase-types/api";

/** How often to check on a running export or import. */
export const RUNNING_TASK_POLLING_INTERVAL_MS = 1500;

/** How many of the changes a conflict would overwrite to list. */
export const MAX_LISTED_CONFLICTS = 10;

export const isTaskRunning = (task: GitSyncTask | null | undefined) =>
  task?.status === "running";

/** What a running export or import is doing. */
export const getRunningTaskMessage = (task: GitSyncTask): string =>
  task.sync_task_type === "export"
    ? t`Exporting to Git…`
    : t`Importing from Git…`;

/** How an ended export or import went, in a sentence. */
export const getTaskOutcomeMessage = (task: GitSyncTask): string => {
  const count = task.outcome?.count ?? 0;
  const branch = task.outcome?.branch ?? "";

  return match(task)
    .with({ status: "running" }, getRunningTaskMessage)
    .with({ status: "successful", outcome: { kind: "pushed" } }, () =>
      ngettext(
        msgid`Exported ${count} change to ${branch}.`,
        `Exported ${count} changes to ${branch}.`,
        count,
      ),
    )
    .with(
      { status: "successful", outcome: { kind: "push-skipped" } },
      () => t`Nothing to export: the branch already has every change.`,
    )
    .with({ status: "successful", outcome: { kind: "pulled" } }, () =>
      ngettext(
        msgid`Imported ${count} item from ${branch}.`,
        `Imported ${count} items from ${branch}.`,
        count,
      ),
    )
    .with(
      { status: "successful", outcome: { kind: "pull-skipped" } },
      () => t`Already up to date with the branch.`,
    )
    .with({ status: "successful" }, () => t`The sync finished.`)
    .with(
      { status: "conflict", outcome: { kind: "remote-changed" } },
      () =>
        t`The branch has changes that aren't imported here yet. Import them first, or export anyway to overwrite them.`,
    )
    .with(
      { status: "conflict", outcome: { kind: "local-changes" } },
      () =>
        t`Synced content changed here since the last sync. Export it first, or import anyway to discard those changes.`,
    )
    .with(
      { status: "timed-out" },
      () =>
        t`The sync stopped responding, probably because the server restarted while it ran.`,
    )
    .with({ status: "cancelled" }, () => t`The sync was cancelled.`)
    .otherwise(() => task.error_message ?? t`The sync failed.`);
};

/** The name of the person who started a task, or that it ran on a schedule. */
export const getTaskInitiatorName = (user: GitSyncTaskUser | null): string => {
  if (!user) {
    return t`Scheduled import`;
  }
  const fullName = [user.first_name, user.last_name]
    .filter((part) => part != null && part !== "")
    .join(" ");
  return fullName || user.email;
};

export const getChangeStatusLabel = (status: RemoteSyncEntityStatus): string =>
  match(status)
    .with("create", () => t`New`)
    .with("update", "touch", () => t`Changed`)
    .with("delete", "removed", () => t`Deleted`)
    .exhaustive();

export const getEntityIcon = (model: RemoteSyncEntityModel): IconName =>
  match<RemoteSyncEntityModel, IconName>(model)
    .with("card", () => "table2")
    .with("dataset", () => "model")
    .with("metric", () => "metric")
    .with("dashboard", () => "dashboard")
    .with("collection", () => "folder")
    .with("document", () => "document")
    .with("nativequerysnippet", () => "snippet")
    .with("timeline", () => "calendar")
    .with("action", () => "bolt")
    .otherwise(() => "document");

/** The first characters of a commit SHA, as Git shows it. */
export const getShortCommit = (commit: string) => commit.slice(0, 7);
