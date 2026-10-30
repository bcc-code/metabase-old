import { t } from "ttag";
import * as Yup from "yup";

import { defaultCron } from "metabase/common/components/Schedule/cron";
import {
  PerformanceTabId,
  type StrategyData,
  strategies as basicStrategies,
  doNotCacheStrategyValidationSchema,
  getAdaptiveStrategyValidationSchema,
  getPerformanceTabMetadata,
  getPositiveIntegerSchema,
  inheritStrategyValidationSchema,
} from "metabase/plugins";
import type { AdminPath } from "metabase/redux/store";
import { CacheDurationUnit } from "metabase-types/api";

export const DEFAULT_CACHE_DURATION_HOURS = 24;

/** Rather than a constant, this is a function, so that ttag runs after the locale is set */
const getDurationStrategyValidationSchema = () =>
  Yup.object({
    type: Yup.string().equals(["duration"]),
    duration: getPositiveIntegerSchema().default(DEFAULT_CACHE_DURATION_HOURS),
    unit: Yup.string()
      .oneOf(Object.values(CacheDurationUnit))
      .default(CacheDurationUnit.Hours),
    refresh_automatically: Yup.boolean().default(false),
  });

const scheduleStrategyValidationSchema = Yup.object({
  type: Yup.string().equals(["schedule"]),
  schedule: Yup.string().default(defaultCron),
  refresh_automatically: Yup.boolean().default(false),
});

/**
 * Every cache invalidation strategy, in the order the strategy picker lists
 * them: the basic ones, plus a fixed duration and a schedule.
 */
export const getGranularStrategies = (): Record<string, StrategyData> => ({
  inherit: {
    ...basicStrategies.inherit,
    validationSchema: inheritStrategyValidationSchema,
  },
  ttl: {
    ...basicStrategies.ttl,
    validationSchema: getAdaptiveStrategyValidationSchema,
  },
  duration: {
    label: () => t`Duration`,
    description: () => t`Keep the cache for a number of hours, minutes or days`,
    shortLabel: () => t`Duration`,
    validationSchema: getDurationStrategyValidationSchema,
  },
  schedule: {
    label: () => t`Schedule`,
    description: () => t`Pick when to regularly invalidate the cache`,
    shortLabel: () => t`Scheduled`,
    validationSchema: scheduleStrategyValidationSchema,
  },
  nocache: {
    ...basicStrategies.nocache,
    validationSchema: doNotCacheStrategyValidationSchema,
  },
});

/** The Performance admin tabs, with the one for dashboard and question policies. */
export const getGranularPerformanceTabMetadata = (): (AdminPath & {
  tabId: string;
})[] => {
  const [databasesTab, ...otherTabs] = getPerformanceTabMetadata();
  return [
    databasesTab,
    {
      getName: () => t`Dashboard and question caching`,
      path: "/admin/performance/dashboards-and-questions",
      key: "performance-dashboards-and-questions",
      tabId: PerformanceTabId.DashboardsAndQuestions,
    },
    ...otherTabs,
  ];
};
