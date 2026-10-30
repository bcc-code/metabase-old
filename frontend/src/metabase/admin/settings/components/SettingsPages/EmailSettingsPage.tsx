import { t } from "ttag";

import { LoadingAndErrorWrapper } from "metabase/common/components/LoadingAndErrorWrapper";
import { useHasTokenFeature } from "metabase/common/hooks";
import { getUserIsAdmin } from "metabase/current-user";
import { useSelector } from "metabase/redux";
import { useGetSettingsQuery } from "metabase/settings";
import {
  AdminSettingInput,
  SettingsPageWrapper,
  SettingsSection,
} from "metabase/settings-components";
import { Text } from "metabase/ui";

import { SMTPConnectionCard } from "../Email/SMTPConnectionCard";
import { EmailFromAddressWidget } from "../widgets/EmailFromAddressWidget";
import { EmailReplyToWidget } from "../widgets/EmailReplyToWidget";
import { SendTestEmailWidget } from "../widgets/SendTestEmailWidget";

export function EmailSettingsPage() {
  const { data: settingValues, isLoading } = useGetSettingsQuery();
  const isEmailConfigured = settingValues?.["email-configured?"];
  const hasEmailAllowListFeature = useHasTokenFeature("email_allow_list");
  const hasEmailRestrictRecipientsFeature = useHasTokenFeature(
    "email_restrict_recipients",
  );
  // password reset emails go through the SMTP server, so only admins configure it
  const isAdmin = useSelector(getUserIsAdmin);

  if (isLoading) {
    return <LoadingAndErrorWrapper loading />;
  }

  return (
    <>
      <SettingsPageWrapper title={t`Email`}>
        {isAdmin ? (
          <SMTPConnectionCard />
        ) : (
          !isEmailConfigured && (
            <Text c="text-secondary">{t`An admin needs to set up the SMTP server first.`}</Text>
          )
        )}
        {isEmailConfigured && (
          <SettingsSection>
            <AdminSettingInput
              name="email-from-name"
              title={t`From Name`}
              placeholder="Metabase"
              inputType="text"
            />
            <EmailFromAddressWidget />
            <EmailReplyToWidget />
            <AdminSettingInput
              name="bcc-enabled?"
              title={t`Add Recipients as CC or BCC`}
              inputType="radio"
              options={[
                { value: "true", label: t`BCC - Hide recipients` },
                {
                  value: "false",
                  label: t`CC - Disclose recipients`,
                },
              ]}
            />
            <AdminSettingInput
              hidden={!hasEmailAllowListFeature}
              name="subscription-allowed-domains"
              title={t`Approved domains for notifications`}
              inputType="text"
            />
            <AdminSettingInput
              hidden={!hasEmailRestrictRecipientsFeature}
              name="user-visibility"
              title={t`Suggest recipients on dashboard subscriptions and alerts`}
              inputType="select"
              options={[
                { value: "all", label: t`Suggest all users` },
                {
                  value: "group",
                  label: t`Only suggest users in the same groups`,
                },
                { value: "none", label: t`Don't show suggestions` },
              ]}
            />
            <SendTestEmailWidget />
          </SettingsSection>
        )}
      </SettingsPageWrapper>
    </>
  );
}
