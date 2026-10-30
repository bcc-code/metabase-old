import { t } from "ttag";

import {
  AdminSettingInput,
  SettingsPageWrapper,
  SettingsSection,
} from "metabase/settings-components";

import { HelpLinkSetting } from "../HelpLinkSetting";

/**
 * Admin > Settings > Appearance > Conceal Metabase: the help link, links to
 * Metabase's website and docs, and the Metabot greeting.
 */
export function ConcealSettingsPage() {
  return (
    <SettingsPageWrapper
      // eslint-disable-next-line metabase/no-literal-metabase-strings -- Admin settings
      title={t`Conceal Metabase`}
      // eslint-disable-next-line metabase/no-literal-metabase-strings -- Admin settings
      description={t`Hide the parts of the app that point to Metabase, so people only see your brand.`}
    >
      <SettingsSection>
        <HelpLinkSetting />
        <AdminSettingInput
          name="show-metabase-links"
          // eslint-disable-next-line metabase/no-literal-metabase-strings -- Admin settings
          title={t`Metabase links`}
          // eslint-disable-next-line metabase/no-literal-metabase-strings -- Admin settings
          description={t`Show links to Metabase's documentation and website, and tips that mention Metabase, outside the admin settings.`}
          inputType="boolean"
        />
        <AdminSettingInput
          name="show-metabot"
          title={t`Metabot greeting`}
          description={t`Show Metabot and a greeting at the top of the home page.`}
          inputType="boolean"
        />
      </SettingsSection>
    </SettingsPageWrapper>
  );
}
