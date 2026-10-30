/**
 * Entry point for this fork's own implementations of features that upstream
 * Metabase only ships in its commercially licensed enterprise edition.
 *
 * Each feature lives in its own folder here and exposes an `initialize*`
 * function that fills the relevant `PLUGIN_*` slots, the same way the
 * enterprise build's `initializePlugins` does. Nothing in this folder may
 * import from `enterprise/`.
 */
import { initializeAdvancedPermissionsPlugin } from "./advanced-permissions";
import { initializeCachingPlugin } from "./caching";
import { initializeCustomVizPlugin } from "./custom-viz";
import { initializeDataAccessPlugin } from "./data-access";
import { initializeGitSyncPlugin } from "./git-sync";
import { initializeSsoPlugin } from "./sso";
import { initializeWhitelabelPlugin } from "./whitelabel";

export function initializeForkPlugins() {
  initializeAdvancedPermissionsPlugin();
  initializeCachingPlugin();
  initializeCustomVizPlugin();
  initializeDataAccessPlugin();
  initializeGitSyncPlugin();
  initializeSsoPlugin();
  initializeWhitelabelPlugin();
}
