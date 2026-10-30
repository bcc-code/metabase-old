import { useCacheConfigs } from "metabase/admin/performance/hooks/useCacheConfigs";
import type { CacheableModel } from "metabase-types/api";

import { getCacheConfigModel } from "../utils";

/**
 * The caching policy of one database, dashboard or question: its saved
 * strategy, which is undefined while loading or when it uses the policy it
 * inherits.
 */
export const useTargetCacheConfig = (
  targetId: number,
  targetModel: CacheableModel,
) => {
  const model = getCacheConfigModel(targetModel);
  const { configs, error, isLoading } = useCacheConfigs({
    model: [model],
    id: targetId,
  });
  const savedStrategy = configs?.find(
    (config) => config.model === model && config.model_id === targetId,
  )?.strategy;
  return { savedStrategy, error, isLoading };
};
