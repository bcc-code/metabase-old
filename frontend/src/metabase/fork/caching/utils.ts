import Question from "metabase-lib/v1/Question";
import type { CacheableDashboard, CacheableModel } from "metabase-types/api";

/** The kind of object the API stores a cache config for. Metrics are questions to the API. */
export type CacheConfigModel = Exclude<CacheableModel, "metric">;

export const getCacheConfigModel = (model: CacheableModel): CacheConfigModel =>
  model === "metric" ? "question" : model;

/** The id and name of a dashboard or question that can have its own caching policy */
export const getCacheTarget = (item: CacheableDashboard | Question) =>
  item instanceof Question
    ? { id: item.id(), name: item.displayName() ?? "" }
    : { id: item.id, name: item.name };
