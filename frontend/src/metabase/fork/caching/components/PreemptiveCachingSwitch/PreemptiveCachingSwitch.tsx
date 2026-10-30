import { useFormikContext } from "formik";
import { t } from "ttag";

import type { PreemptiveCachingSwitchProps } from "metabase/plugins";
import { Switch } from "metabase/ui";
import type { CacheStrategy } from "metabase-types/api";

const isRefreshingAutomatically = (strategy: CacheStrategy) =>
  (strategy.type === "duration" || strategy.type === "schedule") &&
  strategy.refresh_automatically;

/**
 * Turns automatic refreshing of the cached results of a question's or
 * dashboard's duration or schedule policy on and off.
 */
export const PreemptiveCachingSwitch = ({
  handleSwitchToggle,
}: PreemptiveCachingSwitchProps) => {
  const { values } = useFormikContext<CacheStrategy>();

  return (
    <Switch
      checked={isRefreshingAutomatically(values)}
      onChange={handleSwitchToggle}
      label={t`Refresh cache automatically`}
      description={t`As soon as cached results expire, run the queries again with the filter values people used most, so nobody waits for them. Skipped for databases with row and column security or impersonation.`}
    />
  );
};
