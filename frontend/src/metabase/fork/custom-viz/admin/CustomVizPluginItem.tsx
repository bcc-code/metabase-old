import { useDisclosure } from "@mantine/hooks";
import { jt, t } from "ttag";

import {
  useDeleteCustomVizPluginMutation,
  useUpdateCustomVizPluginMutation,
} from "metabase/api";
import { getErrorMessage } from "metabase/api/utils";
import { ConfirmModal } from "metabase/common/components/ConfirmModal";
import { DateTime } from "metabase/common/components/DateTime";
import { Link } from "metabase/common/components/Link";
import { useMetadataToasts } from "metabase/common/hooks";
import {
  ActionIcon,
  Badge,
  Card,
  Group,
  Icon,
  Menu,
  Stack,
  Switch,
  Text,
} from "metabase/ui";
import * as Urls from "metabase/urls";
import type { CustomVizPlugin } from "metabase-types/api";

import { getCustomVizIconName } from "../visualization/render-props";

type CustomVizPluginItemProps = {
  plugin: CustomVizPlugin;
};

export function CustomVizPluginItem({ plugin }: CustomVizPluginItemProps) {
  const [updatePlugin, { isLoading: isUpdating }] =
    useUpdateCustomVizPluginMutation();
  const [deletePlugin] = useDeleteCustomVizPluginMutation();
  const [isDeleteModalOpened, deleteModal] = useDisclosure(false);
  const { sendErrorToast, sendSuccessToast } = useMetadataToasts();
  const name = plugin.display_name;

  const handleEnabledChange = async (enabled: boolean) => {
    try {
      await updatePlugin({ id: plugin.id, enabled }).unwrap();
    } catch (error) {
      sendErrorToast(
        getErrorMessage(error, t`Couldn't update the visualization.`),
      );
    }
  };

  const handleDelete = async () => {
    try {
      await deletePlugin(plugin.id).unwrap();
      deleteModal.close();
      sendSuccessToast(t`Deleted ${name}`);
    } catch (error) {
      sendErrorToast(
        getErrorMessage(error, t`Couldn't delete the visualization.`),
      );
    }
  };

  return (
    <Card withBorder shadow="none" p="lg" role="listitem" aria-label={name}>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Group align="flex-start" gap="md" wrap="nowrap">
          <Icon
            name={getCustomVizIconName(plugin.icon)}
            c="core-brand"
            size={20}
          />
          <Stack gap="xs">
            <Group gap="sm">
              <Text fw="bold">{name}</Text>
              <CustomVizStatusBadge plugin={plugin} />
            </Group>
            <Text c="text-secondary" size="sm">
              {t`Identifier: ${plugin.identifier}`}
            </Text>
            <Text c="text-secondary" size="sm">
              {jt`Updated ${(
                <DateTime
                  key="updated-at"
                  value={plugin.updated_at}
                  unit="minute"
                />
              )}`}
            </Text>
            {plugin.status === "error" && plugin.error_message && (
              <Text c="feedback-negative" size="sm">
                {plugin.error_message}
              </Text>
            )}
          </Stack>
        </Group>
        <Group gap="md" wrap="nowrap">
          <Switch
            label={t`Enabled`}
            aria-label={t`Enable ${name}`}
            checked={plugin.enabled}
            disabled={isUpdating}
            onChange={(event) =>
              handleEnabledChange(event.currentTarget.checked)
            }
          />
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon aria-label={t`More actions for ${name}`}>
                <Icon name="ellipsis" />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                component={Link}
                to={Urls.customVizEdit(plugin.id)}
                leftSection={<Icon name="upload" />}
              >
                {t`Replace bundle`}
              </Menu.Item>
              <Menu.Item
                leftSection={<Icon name="trash" />}
                onClick={deleteModal.open}
              >
                {t`Delete`}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      <ConfirmModal
        opened={isDeleteModalOpened}
        title={t`Delete ${name}?`}
        message={t`Questions and dashboard cards that use it will show a table instead. This can't be undone.`}
        confirmButtonText={t`Delete`}
        confirmButtonProps={{ color: "negative" }}
        onConfirm={handleDelete}
        onClose={deleteModal.close}
      />
    </Card>
  );
}

function CustomVizStatusBadge({ plugin }: CustomVizPluginItemProps) {
  if (plugin.status === "error") {
    return <Badge color="negative">{t`Error`}</Badge>;
  }
  if (!plugin.enabled) {
    return <Badge color="neutral">{t`Disabled`}</Badge>;
  }
  return <Badge color="positive">{t`Active`}</Badge>;
}
