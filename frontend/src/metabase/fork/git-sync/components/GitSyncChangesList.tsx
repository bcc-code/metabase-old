import { t } from "ttag";

import { LoadingAndErrorWrapper } from "metabase/common/components/LoadingAndErrorWrapper";
import { Badge, Group, Icon, Stack, Text } from "metabase/ui";
import type {
  RemoteSyncEntity,
  RemoteSyncEntityStatus,
} from "metabase-types/api";

import { useGetGitSyncChangesQuery } from "../api";
import { getChangeStatusLabel, getEntityIcon } from "../utils";

const STATUS_BADGE_COLORS = {
  create: "positive",
  update: "brand",
  touch: "brand",
  delete: "negative",
  removed: "negative",
} as const satisfies Record<RemoteSyncEntityStatus, string>;

const SYNC_STATUS_ORDER: RemoteSyncEntityStatus[] = [
  "create",
  "update",
  "touch",
  "delete",
  "removed",
];

const sortChanges = (changes: RemoteSyncEntity[]) =>
  [...changes].sort(
    (a, b) =>
      SYNC_STATUS_ORDER.indexOf(a.sync_status) -
        SYNC_STATUS_ORDER.indexOf(b.sync_status) ||
      a.name.localeCompare(b.name),
  );

/** The synced content changed on this instance since it last synced. */
export function GitSyncChangesList() {
  const { data, isLoading, isFetching, error } = useGetGitSyncChangesQuery();

  if (isLoading || error || !data) {
    return <LoadingAndErrorWrapper loading={isLoading} error={error} />;
  }

  if (data.dirty.length === 0) {
    return (
      <Group gap="sm" c="text-secondary">
        <Icon name="check" />
        <Text c="text-secondary">{t`No changes since the last sync.`}</Text>
      </Group>
    );
  }

  return (
    <Stack gap="sm" opacity={isFetching ? 0.6 : 1}>
      <Text fw="bold">
        {t`Changed here since the last sync: ${data.dirty.length}`}
      </Text>
      <Stack component="ul" gap="xs" aria-label={t`Unsynced changes`}>
        {sortChanges(data.dirty).map((change) => (
          <Group
            component="li"
            key={`${change.model}-${change.id}`}
            gap="sm"
            wrap="nowrap"
          >
            <Icon name={getEntityIcon(change.model)} c="icon-secondary" />
            <Text flex={1} truncate>
              {change.name || t`Untitled`}
            </Text>
            <Badge
              variant="light"
              color={STATUS_BADGE_COLORS[change.sync_status]}
            >
              {getChangeStatusLabel(change.sync_status)}
            </Badge>
          </Group>
        ))}
      </Stack>
    </Stack>
  );
}
