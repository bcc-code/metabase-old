import { useDisclosure } from "@mantine/hooks";
import { t } from "ttag";

import { useListDatabasesQuery } from "metabase/api";
import { QuestionPickerModal } from "metabase/common/components/Pickers";
import { useHasTokenFeature } from "metabase/common/hooks";
import { useNavigate } from "metabase/router";
import { useTransformPermissions } from "metabase/transforms/hooks/use-transform-permissions";
import { Button, Center, Icon, Loader, Menu, Tooltip } from "metabase/ui";
import * as Urls from "metabase/urls";

import { trackTransformCreate } from "../../../analytics";
import { CreateTransformCollectionModal } from "../../../components/CreateTransformCollectionModal";

import { shouldDisableItem } from "./utils";

export const CreateTransformMenu = () => {
  const navigate = useNavigate();
  const [isPickerOpened, { open: openPicker, close: closePicker }] =
    useDisclosure();
  const [
    isCollectionModalOpened,
    { open: openCollectionModal, close: closeCollectionModal },
  ] = useDisclosure();

  const hasPythonTransformsFeature = useHasTokenFeature("transforms-python");

  const { data: databases, isLoading } = useListDatabasesQuery({
    include_analytics: true,
  });
  const { remoteSyncReadOnly } = useTransformPermissions();

  const handlePythonClick = () => {
    trackTransformCreate({ creationType: "python" });
    navigate(Urls.newPythonTransform());
  };

  if (remoteSyncReadOnly) {
    return (
      <Tooltip
        label={t`Transforms can't be created when Remote Sync is in read-only mode`}
      >
        <Button
          aria-label={t`Create a transform`}
          disabled
          size="lg"
          leftSection={<Icon name="add" size={16} />}
        >
          {t`New`}
        </Button>
      </Tooltip>
    );
  }

  return (
    <>
      <Menu position="bottom-end">
        <Menu.Target>
          <Tooltip label={t`Create a transform`}>
            <Button
              aria-label={t`Create a transform`}
              size="lg"
              leftSection={<Icon name="add" size={16} />}
            >
              {t`New`}
            </Button>
          </Tooltip>
        </Menu.Target>
        <Menu.Dropdown>
          {isLoading ? (
            <Center>
              <Loader size="sm" />
            </Center>
          ) : (
            <>
              <Menu.Label>{t`Create your transform with…`}</Menu.Label>
              <Menu.Item
                leftSection={<Icon name="notebook" />}
                onClick={() => {
                  trackTransformCreate({ creationType: "query" });
                  navigate(Urls.newQueryTransform());
                }}
              >
                {t`Query builder`}
              </Menu.Item>
              <Menu.Item
                leftSection={<Icon name="sql" />}
                onClick={() => {
                  trackTransformCreate({ creationType: "native" });
                  navigate(Urls.newNativeTransform());
                }}
              >
                {t`SQL query`}
              </Menu.Item>

              {hasPythonTransformsFeature && (
                <Menu.Item
                  leftSection={<Icon name="code_block" />}
                  onClick={handlePythonClick}
                >
                  {t`Python script`}
                </Menu.Item>
              )}
              <Menu.Item
                leftSection={<Icon name="insight" />}
                onClick={() => {
                  trackTransformCreate({ creationType: "saved-question" });
                  openPicker();
                }}
              >
                {t`Copy of a saved question`}
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item
                leftSection={<Icon name="folder" />}
                onClick={openCollectionModal}
              >
                {t`Transform folder`}
              </Menu.Item>
            </>
          )}
        </Menu.Dropdown>
      </Menu>

      {isPickerOpened && (
        <QuestionPickerModal
          title={t`Pick a question or a model`}
          models={["card", "dataset"]}
          isDisabledItem={(item) => shouldDisableItem(item, databases?.data)}
          onChange={(item) => {
            navigate(Urls.newTransformFromCard(item.id));
            closePicker();
          }}
          onClose={closePicker}
        />
      )}

      {isCollectionModalOpened && (
        <CreateTransformCollectionModal onClose={closeCollectionModal} />
      )}
    </>
  );
};
