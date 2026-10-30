import { t } from "ttag";

import { Card, Group, Icon, Progress, Stack, Text } from "metabase/ui";
import type { GitSyncTask } from "metabase-types/api";

import { getRunningTaskMessage } from "../utils";

type GitSyncTaskStatusProps = {
  task: GitSyncTask;
};

/** A floating card with the progress of a running export or import. */
export function GitSyncTaskStatus({ task }: GitSyncTaskStatusProps) {
  const message = getRunningTaskMessage(task);
  const percent = Math.round((task.progress ?? 0) * 100);

  return (
    <Card
      pos="fixed"
      left="1.5rem"
      bottom="1.5rem"
      w="18rem"
      p="md"
      shadow="md"
      withBorder
      role="status"
      aria-label={t`Git sync`}
    >
      <Stack gap="sm">
        <Group gap="sm" wrap="nowrap">
          <Icon name="git_branch" c="icon-brand" />
          <Text fw="bold">{message}</Text>
        </Group>
        <Progress value={percent} aria-label={message} />
      </Stack>
    </Card>
  );
}
