import { t } from "ttag";

import { useSetting, useUserSetting } from "metabase/settings";
import { Box, Switch } from "metabase/ui";

/**
 * Lets people say whether they want to see the SQL and database errors of the
 * queries Metabot writes. Shown only when Metabot is on.
 */
export const SqlErrorsPreference = () => {
  const isMetabotEnabled = useSetting("metabot-enabled?");
  const metabotName = useSetting("metabot-name");
  const [showSqlErrors, setShowSqlErrors] = useUserSetting(
    "metabot-show-sql-errors",
    { shouldDebounce: false },
  );

  if (!isMetabotEnabled) {
    return null;
  }

  return (
    <Box mb="lg">
      <Switch
        checked={Boolean(showSqlErrors)}
        onChange={(event) => setShowSqlErrors(event.currentTarget.checked)}
        label={t`Show me SQL and database errors`}
        description={t`When this is off, ${metabotName} checks the SQL it writes before showing it and fixes queries that fail, and charts don't show technical errors.`}
      />
    </Box>
  );
};
