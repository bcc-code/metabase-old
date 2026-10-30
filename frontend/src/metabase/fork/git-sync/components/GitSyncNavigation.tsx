import type { ComponentProps } from "react";
import { t } from "ttag";

import { SettingsNavItem } from "metabase/admin/settings/components/SettingsNav";
import { ForwardRefLink } from "metabase/common/components/Link";
import { Tree } from "metabase/common/components/tree";
import type { ITreeNodeItem } from "metabase/common/components/tree/types";
import { AreaTab } from "metabase/nav/components/AreaLayout";
import { SidebarCollectionLink } from "metabase/nav/containers/MainNavbar/SidebarItems";
import type {
  GitSyncSetupMenuItemProps,
  PLUGIN_REMOTE_SYNC,
} from "metabase/plugins";
import { useLocation } from "metabase/router";
import { Box, Button, Group, Icon, Tooltip } from "metabase/ui";
import * as Urls from "metabase/urls";

import {
  useCanUseGitSync,
  useGitSyncVisible,
  useRemoteSyncDirtyState,
} from "../hooks";

/** The entry for Git sync in the admin settings navigation. */
export function GitSyncSettingsNavItem() {
  return (
    <SettingsNavItem path="remote-sync" label={t`Git sync`} icon="git_branch" />
  );
}

/** A dot telling that synced content changed since the last sync. */
export function CollectionSyncStatusBadge() {
  const label = t`Changed since the last Git sync`;
  return (
    <Tooltip label={label}>
      <Box
        component="span"
        role="img"
        aria-label={label}
        display="inline-block"
        w="0.5rem"
        h="0.5rem"
        bg="feedback-warning"
        style={{ borderRadius: "50%", flexShrink: 0 }}
      />
    </Tooltip>
  );
}

/** The Git sync tab of Data Studio, for admins. */
export function GitSyncSetupMenuItem({
  isNavbarOpened,
}: GitSyncSetupMenuItemProps) {
  const canUseGitSync = useCanUseGitSync();
  const { pathname } = useLocation();
  const { isDirty } = useRemoteSyncDirtyState();
  const gitSyncUrl = Urls.dataStudioGitSync();

  if (!canUseGitSync) {
    return null;
  }

  return (
    <AreaTab
      label={t`Git sync`}
      icon="git_branch"
      to={gitSyncUrl}
      isSelected={pathname.startsWith(gitSyncUrl)}
      showLabel={isNavbarOpened}
      rightSection={isDirty ? <CollectionSyncStatusBadge /> : null}
    />
  );
}

/** The branch being synced, linking to Git sync, with a dot for local changes. */
export function GitSyncAppBarControls() {
  const { isVisible, currentBranch } = useGitSyncVisible();
  const { isDirty } = useRemoteSyncDirtyState();

  if (!isVisible) {
    return null;
  }

  const branch = currentBranch ?? "";
  return (
    <Button
      component={ForwardRefLink}
      to={Urls.dataStudioGitSync()}
      variant="subtle"
      size="compact-sm"
      ml="sm"
      leftSection={<Icon name="git_branch" aria-hidden />}
      rightSection={isDirty ? <CollectionSyncStatusBadge /> : null}
      aria-label={t`Git sync: ${branch}`}
      data-testid="git-sync-controls"
    >
      {branch}
    </Button>
  );
}

type CollectionsNavTreeProps = ComponentProps<
  NonNullable<(typeof PLUGIN_REMOTE_SYNC)["CollectionsNavTree"]>
>;

const isSyncedCollectionItem = (item: ITreeNodeItem) =>
  "is_remote_synced" in item && item.is_remote_synced === true;

/**
 * The collection tree of the main navigation, with a mark on synced collections
 * and a dot on those holding changes since the last sync.
 */
export function SyncedCollectionsNavTree({
  collections,
  selectedId,
  onSelect,
}: CollectionsNavTreeProps) {
  const { isCollectionDirty } = useRemoteSyncDirtyState();

  const renderRightSection = (item: ITreeNodeItem) => {
    const isSynced = isSyncedCollectionItem(item);
    const isDirty = isCollectionDirty(item.id);
    if (!isSynced && !isDirty) {
      return null;
    }
    return (
      <Group gap="xs" wrap="nowrap" ml="auto" pr="sm">
        {isDirty && <CollectionSyncStatusBadge />}
        {isSynced && (
          <Tooltip label={t`Synced with Git`}>
            <Icon
              name="git_branch"
              size={12}
              c="icon-secondary"
              aria-label={t`Synced with Git`}
            />
          </Tooltip>
        )}
      </Group>
    );
  };

  return (
    <Tree
      data={collections}
      selectedId={selectedId}
      onSelect={onSelect}
      TreeNode={SidebarCollectionLink}
      rightSection={renderRightSection}
      role="tree"
      aria-label="collection-tree"
    />
  );
}
