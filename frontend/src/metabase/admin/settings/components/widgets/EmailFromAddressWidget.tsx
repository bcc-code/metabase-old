import { t } from "ttag";

import { useAdminSetting, useSetting } from "metabase/settings";
import { AdminSettingInput, SettingHeader } from "metabase/settings-components";
import { Box, Icon, TextInput } from "metabase/ui";

export function EmailFromAddressWidget() {
  const { value: fromAddressValue } = useAdminSetting("email-from-address");
  const isHosted = useSetting("is-hosted?");
  const isCloudSMTPEnabled = useSetting("smtp-override-enabled");

  if (!isHosted) {
    return (
      <AdminSettingInput
        title={t`From Address`}
        inputType="text"
        name="email-from-address"
      />
    );
  }

  if (isCloudSMTPEnabled) {
    return (
      <AdminSettingInput
        title={t`From Address`}
        inputType="text"
        name="email-from-address-override"
      />
    );
  }

  return (
    <Box data-testid={`email-from-address-setting`}>
      <SettingHeader
        id={"email-from-address"}
        title={t`From Address`}
        description={t`Please set up a custom SMTP server to change this`}
      />
      <TextInput
        id={"email-from-address"}
        value={fromAddressValue ? fromAddressValue : ""}
        placeholder={"metabase@yourcompany.com"}
        type={"text"}
        disabled
        rightSection={<Icon name="lock" size={12} />}
      />
    </Box>
  );
}
