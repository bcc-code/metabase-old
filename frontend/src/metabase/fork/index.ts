/**
 * Entry point for this fork's own implementations of features that upstream
 * Metabase only ships in its commercially licensed enterprise edition.
 *
 * Each feature lives in its own folder here and exposes an `initialize*`
 * function that fills the relevant `PLUGIN_*` slots, the same way the
 * enterprise build's `initializePlugins` does. Nothing in this folder may
 * import from `enterprise/`.
 */
export function initializeForkPlugins() {}
