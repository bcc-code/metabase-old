import { t } from "ttag";

import { MetabotSlackSetup } from "metabase/admin/ai/MetabotSlackSetup";
import { getUserIsAdmin } from "metabase/current-user";
import { useSelector } from "metabase/redux";
import { SettingsPageWrapper } from "metabase/settings-components";
import { Icon } from "metabase/ui";

import { SlackSetup } from "../../slack/SlackSetup";

export const SlackSettingsPage = () => {
  // Slack Connect signs people in, so only admins configure it
  const isAdmin = useSelector(getUserIsAdmin);

  return (
    <>
      <SettingsPageWrapper
        title={
          <>
            <Icon name="slack_colorized" size={22} mr="sm" /> {t`Slack`}
          </>
        }
      >
        <SlackSetup />
        {isAdmin && <MetabotSlackSetup />}
      </SettingsPageWrapper>
    </>
  );
};
