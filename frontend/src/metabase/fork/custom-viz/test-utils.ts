import { readFileSync } from "fs";
import { join } from "path";

import type { CustomVizPluginRuntime } from "metabase-types/api";
import { createMockCustomVizPluginRuntime } from "metabase-types/api/mocks";

import { loadScript } from "./load-script";
import { parseCustomVizManifest } from "./manifest";
import type { CustomVizManifest } from "./types";

/** The example plugin shipped next to the author guide. */
export const EXAMPLE_BUNDLE_SOURCE = readFileSync(
  join(__dirname, "examples", "progress-ring.js"),
  "utf8",
);

/** The manifest the server would parse out of a bundle's leading comment. */
export function getBundleManifest(source: string): CustomVizManifest {
  const [, manifestText = ""] =
    /\/\* metabase-custom-viz([\s\S]*?)\*\//.exec(source) ?? [];
  const manifestJson: unknown = JSON.parse(manifestText);
  return parseCustomVizManifest(manifestJson);
}

/** A runtime plugin for `source`, served under a URL keyed by `hash`. */
export function createRuntimePlugin(
  source: string,
  hash: string,
  opts: Partial<CustomVizPluginRuntime> = {},
): CustomVizPluginRuntime {
  const manifest = getBundleManifest(source);
  return createMockCustomVizPluginRuntime({
    identifier: manifest.identifier,
    display_name: manifest.name,
    icon: manifest.icon ?? null,
    manifest,
    bundle_url: `/api/custom-viz-plugin/1/bundle?v=${hash}`,
    bundle_hash: hash,
    ...opts,
  });
}

function runBundle(source: string) {
  const script = document.createElement("script");
  script.textContent = source;
  document.head.appendChild(script);
  script.remove();
}

/**
 * Makes the mocked `loadScript` run each bundle in `bundlesByUrl` the way a
 * browser would. Call `jest.mock("./load-script")` in the spec first.
 */
export function mockBundles(bundlesByUrl: Record<string, string>) {
  jest.mocked(loadScript).mockImplementation(async (url) => {
    const source = bundlesByUrl[url];
    if (source === undefined) {
      throw new Error("The bundle couldn't be downloaded.");
    }
    runBundle(source);
  });
}
