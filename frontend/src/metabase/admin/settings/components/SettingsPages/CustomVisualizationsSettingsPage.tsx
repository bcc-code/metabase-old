import { t } from "ttag";

import { useHasTokenFeature, useMetadataToasts } from "metabase/common/hooks";
import { PLUGIN_CUSTOM_VIZ } from "metabase/plugins";
import { useParams } from "metabase/router";
import { useAdminSetting } from "metabase/settings";
import { SettingsPageWrapper } from "metabase/settings-components";
import { Alert, Button, Card, Icon, Stack, Text, Title } from "metabase/ui";
import { reload } from "metabase/utils/dom";

export function CustomVisualizationsManagePage() {
  const isCustomVizOn = useHasTokenFeature("custom-viz");

  if (!isCustomVizOn) {
    return <CustomVizTurnedOffState />;
  }

  return <PLUGIN_CUSTOM_VIZ.ManageCustomVizPage />;
}

export function CustomVisualizationsFormPage() {
  const params = useParams<{ id: string }>();
  const isCustomVizOn = useHasTokenFeature("custom-viz");

  if (!isCustomVizOn) {
    return <CustomVizTurnedOffState />;
  }

  return <PLUGIN_CUSTOM_VIZ.CustomVizPage params={params} />;
}

export function CustomVisualizationsDevelopmentPage() {
  const isCustomVizOn = useHasTokenFeature("custom-viz");

  if (!isCustomVizOn) {
    return <CustomVizTurnedOffState />;
  }

  return <PLUGIN_CUSTOM_VIZ.CustomVizDevPage />;
}

const CUSTOM_VIZ_ENABLED_SETTING = "custom-visualizations-enabled";

function CustomVizTurnedOffState() {
  const { updateSetting } = useAdminSetting(CUSTOM_VIZ_ENABLED_SETTING);
  const { sendErrorToast } = useMetadataToasts();

  const handleTurnOn = async () => {
    const { error } = await updateSetting({
      key: CUSTOM_VIZ_ENABLED_SETTING,
      value: true,
      toast: false,
    });

    if (error) {
      sendErrorToast(t`Failed to turn on custom visualizations`);
    } else {
      reload();
    }
  };

  return (
    <SettingsPageWrapper title={t`Custom visualizations`}>
      <Card bg="background_page-primary" p={48} maw={640} withBorder>
        <Stack gap="lg">
          <Stack gap="sm">
            <Title order={3}>{t`Custom visualizations are turned off`}</Title>
            <Text c="text-secondary" lh="1.25rem">
              {t`Turn them on to let everyone use the chart types your team installs as JavaScript bundles.`}
            </Text>
            <Alert
              size="compact"
              title={t`Security risk`}
              icon={<Icon name="warning" />}
            >
              {t`A custom visualization runs arbitrary JavaScript in the browser of everyone who views it, so only install bundles from people you trust.`}
            </Alert>
          </Stack>
          <Stack align="flex-start">
            <Button variant="filled" onClick={handleTurnOn}>
              {t`Turn on custom visualizations`}
            </Button>
          </Stack>
        </Stack>
      </Card>
    </SettingsPageWrapper>
  );
}
