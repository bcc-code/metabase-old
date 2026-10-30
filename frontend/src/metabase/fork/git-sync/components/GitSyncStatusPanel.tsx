import { useDisclosure } from "@mantine/hooks";
import { useState } from "react";
import { t } from "ttag";

import { getErrorMessage } from "metabase/api/utils/errors";
import { ConfirmModal } from "metabase/common/components/ConfirmModal";
import { LoadingAndErrorWrapper } from "metabase/common/components/LoadingAndErrorWrapper";
import { dayjs } from "metabase/dayjs";
import {
  Alert,
  Badge,
  Button,
  Group,
  Icon,
  List,
  Modal,
  Progress,
  Stack,
  Text,
  Textarea,
} from "metabase/ui";
import type { GitSyncStatus, GitSyncTask } from "metabase-types/api";

import { useExportGitSyncMutation, useImportGitSyncMutation } from "../api";
import { useGitSyncStatus } from "../hooks";
import {
  MAX_LISTED_CONFLICTS,
  getRunningTaskMessage,
  getShortCommit,
  getTaskInitiatorName,
  getTaskOutcomeMessage,
  isTaskRunning,
} from "../utils";

/**
 * Where Git sync stands, with the controls to export and import: the branch,
 * the last export and import, the running task's progress, and how the latest
 * task ended.
 */
export function GitSyncStatusPanel() {
  const { status, currentTask, isLoading, error } = useGitSyncStatus();

  if (isLoading || error || !status) {
    return <LoadingAndErrorWrapper loading={isLoading} error={error} />;
  }

  return <GitSyncStatusContent status={status} currentTask={currentTask} />;
}

type GitSyncStatusContentProps = {
  status: GitSyncStatus;
  currentTask: GitSyncTask | null;
};

function GitSyncStatusContent({
  status,
  currentTask,
}: GitSyncStatusContentProps) {
  const [exportGitSync, exportState] = useExportGitSyncMutation();
  const [importGitSync, importState] = useImportGitSyncMutation();
  const [isExportOpened, exportModal] = useDisclosure(false);
  const [confirmation, setConfirmation] = useState<
    "force-export" | "force-import" | null
  >(null);

  const isReadOnly = status.type === "read-only";
  const isRunning = isTaskRunning(currentTask);
  const isStarting = exportState.isLoading || importState.isLoading;
  const latestTask = status.latest_task;
  const startError = exportState.error ?? importState.error;

  const handleExport = async (message: string, force = false) => {
    exportModal.close();
    await exportGitSync({ message: message || undefined, force });
  };

  const handleImport = async (force = false) => {
    await importGitSync({ force });
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap="xs">
          <Group gap="sm">
            <Icon name="git_branch" c="icon-secondary" />
            <Text fw="bold">{status.branch}</Text>
            <Badge variant="light" color={isReadOnly ? "warning" : "brand"}>
              {isReadOnly ? t`Read-only` : t`Read-write`}
            </Badge>
            {status.auto_import && (
              <Badge
                variant="light"
                color="neutral"
              >{t`Imports on a schedule`}</Badge>
            )}
          </Group>
          {status.url && (
            <Text c="text-secondary" fz="sm">
              {status.url}
            </Text>
          )}
          <Text c="text-secondary" fz="sm">
            {status.last_synced_commit
              ? t`Last synced commit: ${getShortCommit(status.last_synced_commit)}`
              : t`Not synced yet`}
          </Text>
          <LastTaskLine label={t`Last export`} task={status.last_export} />
          <LastTaskLine label={t`Last import`} task={status.last_import} />
        </Stack>
        <Group gap="sm" wrap="nowrap">
          {!isReadOnly && (
            <Button
              leftSection={<Icon name="upload" aria-hidden />}
              disabled={isRunning || isStarting}
              onClick={exportModal.open}
            >
              {t`Export`}
            </Button>
          )}
          <Button
            leftSection={<Icon name="download" aria-hidden />}
            variant={isReadOnly ? "filled" : "default"}
            disabled={isRunning || isStarting}
            onClick={() => handleImport()}
          >
            {t`Import`}
          </Button>
        </Group>
      </Group>

      {currentTask && isRunning ? (
        <RunningTask task={currentTask} />
      ) : (
        latestTask && (
          <TaskOutcome
            task={latestTask}
            isReadOnly={isReadOnly}
            onForceExport={() => setConfirmation("force-export")}
            onForceImport={() => setConfirmation("force-import")}
            onImport={() => handleImport()}
          />
        )
      )}

      {startError != null && (
        <Alert color="error" icon={<Icon name="warning" />}>
          {getErrorMessage(startError)}
        </Alert>
      )}

      <ExportModal
        opened={isExportOpened}
        onClose={exportModal.close}
        onExport={(message) => handleExport(message)}
      />
      <ConfirmModal
        opened={confirmation === "force-export"}
        title={t`Export anyway?`}
        message={t`The export overwrites the changes on the branch that aren't imported here.`}
        confirmButtonText={t`Export anyway`}
        confirmButtonProps={{ color: "negative" }}
        onConfirm={async () => {
          setConfirmation(null);
          await handleExport("", true);
        }}
        onClose={() => setConfirmation(null)}
      />
      <ConfirmModal
        opened={confirmation === "force-import"}
        title={t`Discard local changes?`}
        message={t`The import replaces the synced content changed here since the last sync, and deletes what was created here and isn't on the branch.`}
        confirmButtonText={t`Discard and import`}
        confirmButtonProps={{ color: "negative" }}
        onConfirm={async () => {
          setConfirmation(null);
          await handleImport(true);
        }}
        onClose={() => setConfirmation(null)}
      />
    </Stack>
  );
}

function LastTaskLine({
  label,
  task,
}: {
  label: string;
  task: GitSyncTask | null;
}) {
  if (!task?.ended_at) {
    return null;
  }
  const when = dayjs(task.ended_at).fromNow();
  const who = getTaskInitiatorName(task.initiated_by_user);
  return (
    <Text c="text-secondary" fz="sm">
      {t`${label}: ${when} (${who})`}
    </Text>
  );
}

function RunningTask({ task }: { task: GitSyncTask }) {
  const percent = Math.round((task.progress ?? 0) * 100);
  return (
    <Stack gap="xs" aria-live="polite">
      <Text fw="bold">{getRunningTaskMessage(task)}</Text>
      <Progress value={percent} aria-label={getRunningTaskMessage(task)} />
    </Stack>
  );
}

type TaskOutcomeProps = {
  task: GitSyncTask;
  isReadOnly: boolean;
  onForceExport: () => void;
  onForceImport: () => void;
  onImport: () => void;
};

function TaskOutcome({
  task,
  isReadOnly,
  onForceExport,
  onForceImport,
  onImport,
}: TaskOutcomeProps) {
  const message = getTaskOutcomeMessage(task);
  const listedConflicts = task.conflicts.slice(0, MAX_LISTED_CONFLICTS);
  const hiddenConflictCount = task.conflicts.length - listedConflicts.length;

  if (task.status === "successful") {
    return (
      <Alert color="success" icon={<Icon name="check" />}>
        {message}
      </Alert>
    );
  }

  if (task.status === "conflict") {
    const isRemoteChanged = task.outcome?.kind === "remote-changed";
    return (
      <Alert color="warning" icon={<Icon name="warning" />}>
        <Stack gap="sm">
          <Text>{message}</Text>
          {listedConflicts.length > 0 && (
            <List size="sm">
              {listedConflicts.map((conflict) => (
                <List.Item key={conflict}>{conflict}</List.Item>
              ))}
              {hiddenConflictCount > 0 && (
                <List.Item>{t`and ${hiddenConflictCount} more`}</List.Item>
              )}
            </List>
          )}
          <Group gap="sm">
            {isRemoteChanged ? (
              <>
                <Button
                  size="compact-sm"
                  onClick={onImport}
                >{t`Import`}</Button>
                {!isReadOnly && (
                  <Button
                    size="compact-sm"
                    variant="default"
                    onClick={onForceExport}
                  >
                    {t`Export anyway`}
                  </Button>
                )}
              </>
            ) : (
              <Button
                size="compact-sm"
                variant="default"
                onClick={onForceImport}
              >
                {t`Discard local changes and import`}
              </Button>
            )}
          </Group>
        </Stack>
      </Alert>
    );
  }

  return (
    <Alert color="error" icon={<Icon name="warning" />}>
      {message}
    </Alert>
  );
}

type ExportModalProps = {
  opened: boolean;
  onClose: () => void;
  onExport: (message: string) => void;
};

function ExportModal({ opened, onClose, onExport }: ExportModalProps) {
  const [message, setMessage] = useState("");

  return (
    <Modal opened={opened} title={t`Export to Git`} onClose={onClose}>
      <Stack gap="lg">
        <Textarea
          label={t`Commit message`}
          placeholder={t`Describe what changed (optional)`}
          value={message}
          autosize
          minRows={3}
          onChange={(event) => setMessage(event.target.value)}
        />
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose}>{t`Cancel`}</Button>
          <Button
            variant="filled"
            onClick={() => {
              onExport(message.trim());
              setMessage("");
            }}
          >{t`Export`}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
