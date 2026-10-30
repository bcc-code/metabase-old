import { t } from "ttag";

import { getShortStrategyLabel } from "metabase/admin/performance/utils";
import { DelayedLoadingAndErrorWrapper } from "metabase/common/components/LoadingAndErrorWrapper/DelayedLoadingAndErrorWrapper";
import { SidesheetButtonWithChevron } from "metabase/common/components/Sidesheet";
import { useUniqueId } from "metabase/common/hooks/use-unique-id";
import type { SidebarCacheSectionProps } from "metabase/plugins";
import { Flex, Text } from "metabase/ui";

import { useTargetCacheConfig } from "../../hooks/useTargetCacheConfig";
import { getCacheTarget } from "../../utils";

/**
 * The current caching policy of a dashboard or question in its settings
 * sidesheet, with a button that opens the caching settings.
 */
export const SidebarCacheSection = ({
  item,
  model,
  setPage,
}: SidebarCacheSectionProps) => {
  const { id } = getCacheTarget(item);
  const { savedStrategy, error, isLoading } = useTargetCacheConfig(id, model);
  const labelId = useUniqueId();
  const policyId = useUniqueId();

  return (
    <DelayedLoadingAndErrorWrapper loading={isLoading} error={error}>
      <Flex align="center" justify="space-between" gap="md">
        <Text id={labelId}>{t`When to get new results`}</Text>
        <SidesheetButtonWithChevron
          aria-labelledby={labelId}
          aria-describedby={policyId}
          onClick={() => setPage("caching")}
        >
          <span id={policyId}>
            {getShortStrategyLabel(savedStrategy ?? { type: "inherit" }, model)}
          </span>
        </SidesheetButtonWithChevron>
      </Flex>
    </DelayedLoadingAndErrorWrapper>
  );
};
