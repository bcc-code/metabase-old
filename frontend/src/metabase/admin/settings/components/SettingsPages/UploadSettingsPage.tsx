import { t } from "ttag";

import { PLUGIN_UPLOAD_MANAGEMENT } from "metabase/plugins";
import {
  SettingsPageWrapper,
  SettingsSection,
} from "metabase/settings-components";

import { UploadSettingsForm } from "../UploadSettings/UploadSettingsForm";

export function UploadSettingsPage() {
  return (
    <SettingsPageWrapper title={t`Uploads`}>
      <SettingsSection>
        <UploadSettingsForm />
        <PLUGIN_UPLOAD_MANAGEMENT.UploadManagementTable />
      </SettingsSection>
    </SettingsPageWrapper>
  );
}
