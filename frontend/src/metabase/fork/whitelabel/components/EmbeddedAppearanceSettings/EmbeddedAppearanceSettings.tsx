import { t } from "ttag";

import { AdminSettingInput } from "metabase/settings-components";
import { Stack } from "metabase/ui";

import { getLoadingMessageOptions } from "../../constants";
import { EmptyStateIllustrationSettings } from "../IllustrationSettings";

/**
 * The branding settings that show inside embeds: the loading message and the
 * illustrations for empty results.
 */
export function EmbeddedAppearanceSettings() {
  return (
    <Stack gap="xl">
      <AdminSettingInput
        name="loading-message"
        title={t`Loading message`}
        description={t`The message shown while a query runs.`}
        inputType="select"
        options={getLoadingMessageOptions()}
        maw="20rem"
      />
      <EmptyStateIllustrationSettings />
    </Stack>
  );
}
