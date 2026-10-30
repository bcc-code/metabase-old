import { t } from "ttag";

import { customVizPluginApi } from "metabase/api";
import { runRtkEndpoint } from "metabase/api/utils/run-rtk-endpoint";
import type { ToastArgs } from "metabase/common/hooks";
import type { LoadCustomVizPluginForDisplayResult } from "metabase/plugins";
import type { Dispatch } from "metabase/redux/store";
import { getSubpathSafeUrl } from "metabase/urls";
import { getCustomPluginIdentifier } from "metabase/visualizations/custom-visualizations/custom-viz-utils";
import { registerVisualization, visualizations } from "metabase/viz-core";
import type {
  CustomVizPluginRuntime,
  VisualizationDisplay,
} from "metabase-types/api";
import {
  isCustomVizDisplay,
  isCustomVizPluginRuntime,
} from "metabase-types/guards";

import { installCustomVizHostApi, takeCustomVizDefinition } from "./host";
import { loadScript } from "./load-script";
import { parseCustomVizManifest } from "./manifest";
import { createCustomVisualization } from "./visualization/create-custom-visualization";

type LoadCustomVizPluginOptions = {
  onMessage?: (toast: ToastArgs) => void;
};

/** Loads by `<identifier>:<bundle hash>`, so each bundle version runs once. */
const loads = new Map<string, Promise<VisualizationDisplay>>();
const reportedFailures = new Set<string>();

function getLoadKey(plugin: CustomVizPluginRuntime) {
  return `${plugin.identifier}:${plugin.bundle_hash ?? plugin.bundle_url}`;
}

function getMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function loadAndRegister(
  plugin: CustomVizPluginRuntime,
): Promise<VisualizationDisplay> {
  const manifest = parseCustomVizManifest(plugin.manifest);
  if (manifest.identifier !== plugin.identifier) {
    throw new Error(
      t`The manifest's identifier doesn't match the installed visualization.`,
    );
  }

  installCustomVizHostApi();
  await loadScript(getSubpathSafeUrl(plugin.bundle_url));

  const visualization = createCustomVisualization({
    manifest,
    displayName: plugin.display_name,
    icon: plugin.icon,
    definition: takeCustomVizDefinition(plugin.identifier),
  });
  // A replaced bundle registers its new version under the same display.
  visualizations.delete(visualization.identifier);
  registerVisualization(visualization);

  return visualization.identifier;
}

/**
 * Loads a plugin's bundle and registers it as the `custom:<identifier>`
 * visualization. Resolves to that display, or `null` when the plugin can't be
 * loaded, after reporting why through `onMessage` once per bundle version.
 */
export async function loadCustomVizPlugin(
  plugin: CustomVizPluginRuntime,
  options: LoadCustomVizPluginOptions = {},
): Promise<VisualizationDisplay | null> {
  const key = getLoadKey(plugin);
  const load = loads.get(key) ?? loadAndRegister(plugin);
  loads.set(key, load);

  try {
    return await load;
  } catch (error) {
    if (options.onMessage && !reportedFailures.has(key)) {
      reportedFailures.add(key);
      options.onMessage({
        variant: "negative",
        message: t`The custom visualization “${plugin.display_name}” couldn't be loaded: ${getMessage(error)}`,
      });
    }
    return null;
  }
}

async function fetchCustomVizPluginRuntimes(
  dispatch: Dispatch,
): Promise<CustomVizPluginRuntime[]> {
  const response: unknown = await runRtkEndpoint(
    undefined,
    dispatch,
    customVizPluginApi.endpoints.listCustomVizPluginRuntimes,
    { forceRefetch: false },
  );
  return Array.isArray(response)
    ? response.filter(isCustomVizPluginRuntime)
    : [];
}

/**
 * Loads the plugin behind a `custom:*` display, when it is installed and
 * enabled, so a saved question or dashboard card using it can render.
 */
export async function loadCustomVizPluginForDisplay(
  dispatch: Dispatch,
  display: string,
): Promise<LoadCustomVizPluginForDisplayResult> {
  if (!isCustomVizDisplay(display)) {
    return { status: "unavailable" };
  }
  if (visualizations.has(display)) {
    return { status: "loaded", display };
  }

  let plugins: CustomVizPluginRuntime[];
  try {
    plugins = await fetchCustomVizPluginRuntimes(dispatch);
  } catch {
    return { status: "error" };
  }

  const plugin = plugins.find(
    (candidate) => getCustomPluginIdentifier(candidate) === display,
  );
  if (!plugin) {
    return { status: "unavailable" };
  }

  const loadedDisplay = await loadCustomVizPlugin(plugin);
  return loadedDisplay
    ? { status: "loaded", display: loadedDisplay }
    : { status: "error" };
}
