import type { CustomVizPluginRuntime } from "metabase-types/api";

import { isObject } from "./common";

export function isCustomVizPluginRuntime(
  value: unknown,
): value is CustomVizPluginRuntime {
  return (
    isObject(value) &&
    typeof value.id === "number" &&
    typeof value.identifier === "string" &&
    typeof value.display_name === "string" &&
    typeof value.bundle_url === "string" &&
    (value.icon === null || typeof value.icon === "string") &&
    Array.isArray(value.warnings)
  );
}
