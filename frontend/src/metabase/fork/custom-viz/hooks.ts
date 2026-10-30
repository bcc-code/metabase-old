import { useCallback, useEffect, useState } from "react";

import { useListCustomVizPluginRuntimesQuery } from "metabase/api";
import { useHasTokenFeature } from "metabase/common/hooks";
import type { IconData } from "metabase/common/utils/icon";
import { useDispatch } from "metabase/redux";
import { getCustomPluginIdentifier } from "metabase/visualizations/custom-visualizations/custom-viz-utils";
import { visualizations } from "metabase/viz-core";
import type {
  CustomVizPluginRuntime,
  VisualizationDisplay,
} from "metabase-types/api";
import { isCustomVizDisplay } from "metabase-types/guards";

import { loadCustomVizPluginForDisplay } from "./loader";
import { getCustomVizIconName } from "./visualization/render-props";

type UseCustomVizPluginsResult = {
  plugins: CustomVizPluginRuntime[] | undefined;
  isLoading: boolean;
};

const NO_PLUGINS: UseCustomVizPluginsResult = { plugins: [], isLoading: false };

/**
 * The custom visualizations the current user can use: none while custom
 * visualizations are turned off, and `undefined` while the list loads.
 */
export function useCustomVizPlugins({
  enabled = true,
}: { enabled?: boolean } = {}): UseCustomVizPluginsResult {
  const isCustomVizOn = useHasTokenFeature("custom-viz");
  const shouldFetch = enabled && isCustomVizOn;
  const { data, isLoading } = useListCustomVizPluginRuntimesQuery(undefined, {
    skip: !shouldFetch,
  });

  return shouldFetch ? { plugins: data, isLoading } : NO_PLUGINS;
}

/**
 * Loads the plugin behind a `custom:*` display that isn't registered yet.
 * `loading` stays true until the plugin is registered or turns out to be
 * unavailable, in which case the display renders as a table.
 */
export function useAutoLoadCustomVizPlugin(display: string | undefined) {
  const dispatch = useDispatch();
  const [settledDisplay, setSettledDisplay] = useState<string>();
  const needsPlugin =
    isCustomVizDisplay(display) && !visualizations.has(display);

  useEffect(() => {
    if (!needsPlugin || display === undefined) {
      return;
    }
    let isCancelled = false;
    loadCustomVizPluginForDisplay(dispatch, display).then(() => {
      if (!isCancelled) {
        setSettledDisplay(display);
      }
    });
    return () => {
      isCancelled = true;
    };
  }, [dispatch, display, needsPlugin]);

  return { loading: needsPlugin && settledDisplay !== display };
}

/** Returns a lookup of the icon of each installed custom visualization. */
export function useCustomVizPluginsIcon() {
  const { plugins, isLoading } = useCustomVizPlugins();

  return useCallback(
    (
      display: VisualizationDisplay,
    ): { icon: IconData | undefined; isLoading: boolean } => {
      const plugin = plugins?.find(
        (candidate) => getCustomPluginIdentifier(candidate) === display,
      );
      return {
        icon: plugin ? { name: getCustomVizIconName(plugin.icon) } : undefined,
        isLoading,
      };
    },
    [plugins, isLoading],
  );
}
