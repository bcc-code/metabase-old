import { PLUGIN_REMOTE_SYNC } from "metabase/plugins";

import {
  CollectionSyncStatusBadge,
  GitSyncAppBarControls,
  GitSyncSettingsNavItem,
  GitSyncSetupMenuItem,
  SyncedCollectionsNavTree,
} from "./components/GitSyncNavigation";
import { GitSyncPage } from "./components/GitSyncPage";
import {
  useGitSyncVisible,
  useHasSnippetsDirtyChanges,
  useRemoteSyncDirtyState,
} from "./hooks";
import { getIsRemoteSyncReadOnly } from "./selectors";
import { useSyncStatus } from "./use-sync-status";

/**
 * Fills the remote sync plugin slot with Git sync: the settings and sync page,
 * its entries in the admin settings, Data Studio and app bar, marks on synced
 * collections, local change tracking, and read-only mode.
 */
export function initializeGitSyncPlugin() {
  PLUGIN_REMOTE_SYNC.isEnabled = true;
  PLUGIN_REMOTE_SYNC.LibraryNav = GitSyncSettingsNavItem;
  PLUGIN_REMOTE_SYNC.RemoteSyncSettings = GitSyncPage;
  PLUGIN_REMOTE_SYNC.GitSyncAppBarControls = GitSyncAppBarControls;
  PLUGIN_REMOTE_SYNC.GitSyncSetupMenuItem = GitSyncSetupMenuItem;
  PLUGIN_REMOTE_SYNC.CollectionsNavTree = SyncedCollectionsNavTree;
  PLUGIN_REMOTE_SYNC.CollectionSyncStatusBadge = CollectionSyncStatusBadge;
  PLUGIN_REMOTE_SYNC.useSyncStatus = useSyncStatus;
  PLUGIN_REMOTE_SYNC.useGitSyncVisible = useGitSyncVisible;
  PLUGIN_REMOTE_SYNC.useRemoteSyncDirtyState = useRemoteSyncDirtyState;
  PLUGIN_REMOTE_SYNC.useHasSnippetsDirtyChanges = useHasSnippetsDirtyChanges;
  PLUGIN_REMOTE_SYNC.getIsRemoteSyncReadOnly = getIsRemoteSyncReadOnly;
}
