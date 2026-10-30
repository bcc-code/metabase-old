import { useState } from "react";
import { t } from "ttag";

import { getErrorMessage } from "metabase/api/utils/errors";
import { LoadingAndErrorWrapper } from "metabase/common/components/LoadingAndErrorWrapper";
import { Alert, Group, Icon, Stack, Switch, Text } from "metabase/ui";
import type { GitSyncCollection } from "metabase-types/api";

import {
  useListGitSyncCollectionsQuery,
  useUpdateGitSyncCollectionMutation,
} from "../api";

type SyncedCollectionsListProps = {
  isReadOnly: boolean;
};

/**
 * The top-level collections, each with a switch that syncs it, and everything
 * under it, or stops syncing it.
 */
export function SyncedCollectionsList({
  isReadOnly,
}: SyncedCollectionsListProps) {
  const { data, isLoading, error } = useListGitSyncCollectionsQuery();
  const [updateCollection] = useUpdateGitSyncCollectionMutation();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<unknown>(null);

  if (isLoading || error || !data) {
    return <LoadingAndErrorWrapper loading={isLoading} error={error} />;
  }

  const handleToggle = async (
    collection: GitSyncCollection,
    synced: boolean,
  ) => {
    setPendingId(collection.id);
    setUpdateError(null);
    const result = await updateCollection({ id: collection.id, synced });
    if (result.error) {
      setUpdateError(result.error);
    }
    setPendingId(null);
  };

  return (
    <Stack gap="md">
      {isReadOnly && (
        <Text c="text-secondary">
          {t`This instance only imports from Git, so the collections it syncs are the ones on the branch.`}
        </Text>
      )}
      {updateError != null && (
        <Alert color="error" icon={<Icon name="warning" />}>
          {getErrorMessage(updateError)}
        </Alert>
      )}
      {data.length === 0 ? (
        <Text c="text-secondary">{t`There are no collections to sync yet.`}</Text>
      ) : (
        <Stack component="ul" gap="sm" aria-label={t`Collections`}>
          {data.map((collection) => (
            <Group
              component="li"
              key={collection.id}
              justify="space-between"
              wrap="nowrap"
            >
              <Group gap="sm" wrap="nowrap" miw={0}>
                <Icon
                  name={
                    collection.is_remote_synced ? "synced_collection" : "folder"
                  }
                  c={
                    collection.is_remote_synced
                      ? "icon-brand"
                      : "icon-secondary"
                  }
                />
                <Stack gap={0} miw={0}>
                  <Text truncate>{collection.name}</Text>
                  {collection.description && (
                    <Text c="text-secondary" fz="sm" truncate>
                      {collection.description}
                    </Text>
                  )}
                </Stack>
              </Group>
              <Switch
                aria-label={t`Sync ${collection.name}`}
                checked={collection.is_remote_synced}
                disabled={isReadOnly || pendingId === collection.id}
                onChange={(event) =>
                  handleToggle(collection, event.currentTarget.checked)
                }
              />
            </Group>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
