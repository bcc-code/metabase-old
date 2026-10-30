import type { State } from "metabase/redux/store";
import { getSetting } from "metabase/settings";

/** Whether a Git repository is connected. */
export const getIsGitSyncEnabled = (state: State): boolean =>
  getSetting(state, "remote-sync-enabled") === true;

/**
 * Whether this instance only imports from Git, so the content it syncs can't
 * be edited here.
 */
export const getIsRemoteSyncReadOnly = (state: State): boolean =>
  getIsGitSyncEnabled(state) &&
  getSetting(state, "remote-sync-type") === "read-only";
