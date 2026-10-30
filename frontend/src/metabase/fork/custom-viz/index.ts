import { PLUGIN_CUSTOM_VIZ } from "metabase/plugins";

import { CustomVizPage } from "./admin/CustomVizPage";
import { ManageCustomVizPage } from "./admin/ManageCustomVizPage";
import {
  useAutoLoadCustomVizPlugin,
  useCustomVizPlugins,
  useCustomVizPluginsIcon,
} from "./hooks";
import { loadCustomVizPlugin, loadCustomVizPluginForDisplay } from "./loader";

/**
 * Custom visualizations: admins install JavaScript bundles that register a
 * `custom:<identifier>` visualization, which everyone can then pick for
 * questions and dashboard cards. README.md in this folder documents the
 * plugin contract.
 */
export function initializeCustomVizPlugin() {
  PLUGIN_CUSTOM_VIZ.ManageCustomVizPage = ManageCustomVizPage;
  PLUGIN_CUSTOM_VIZ.CustomVizPage = CustomVizPage;
  PLUGIN_CUSTOM_VIZ.useCustomVizPlugins = useCustomVizPlugins;
  PLUGIN_CUSTOM_VIZ.loadCustomVizPlugin = loadCustomVizPlugin;
  PLUGIN_CUSTOM_VIZ.loadCustomVizPluginForDisplay =
    loadCustomVizPluginForDisplay;
  PLUGIN_CUSTOM_VIZ.useAutoLoadCustomVizPlugin = useAutoLoadCustomVizPlugin;
  PLUGIN_CUSTOM_VIZ.useCustomVizPluginsIcon = useCustomVizPluginsIcon;
}
