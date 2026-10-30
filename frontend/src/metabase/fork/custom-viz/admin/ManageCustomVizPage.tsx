import { t } from "ttag";

import { useListCustomVizPluginsQuery } from "metabase/api";
import { Link } from "metabase/common/components/Link";
import { LoadingAndErrorWrapper } from "metabase/common/components/LoadingAndErrorWrapper";
import {
  AdminSettingInput,
  SettingsPageWrapper,
  SettingsSection,
} from "metabase/settings-components";
import { Button, Group, Icon, Stack, Text, Title } from "metabase/ui";
import * as Urls from "metabase/urls";

import { CustomVizPluginItem } from "./CustomVizPluginItem";
import { TrustedCodeAlert } from "./TrustedCodeAlert";

export function ManageCustomVizPage() {
  const {
    data: plugins = [],
    isLoading,
    error,
  } = useListCustomVizPluginsQuery();

  return (
    <SettingsPageWrapper
      title={t`Custom visualizations`}
      description={t`Add chart types your team builds as JavaScript bundles. Everyone can pick the enabled ones for questions and dashboard cards, like the built-in visualizations.`}
    >
      <TrustedCodeAlert />
      <SettingsSection>
        <Group justify="space-between">
          <Title order={2} size="h4">{t`Installed visualizations`}</Title>
          <Button
            component={Link}
            to={Urls.customVizAdd()}
            variant="filled"
            leftSection={<Icon name="add" />}
          >
            {t`Add visualization`}
          </Button>
        </Group>
        <LoadingAndErrorWrapper loading={isLoading} error={error}>
          {plugins.length === 0 ? (
            <Text c="text-secondary">
              {t`No custom visualizations yet. Add one by uploading its JavaScript bundle.`}
            </Text>
          ) : (
            <Stack gap="md" role="list">
              {plugins.map((plugin) => (
                <CustomVizPluginItem key={plugin.id} plugin={plugin} />
              ))}
            </Stack>
          )}
        </LoadingAndErrorWrapper>
      </SettingsSection>
      <SettingsSection>
        <AdminSettingInput
          name="custom-visualizations-enabled"
          inputType="boolean"
          title={t`Use custom visualizations`}
          description={t`Turn this off to stop loading every custom visualization. Questions that use one show a table instead until you turn it back on.`}
        />
      </SettingsSection>
    </SettingsPageWrapper>
  );
}
