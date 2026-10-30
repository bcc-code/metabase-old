import fetchMock from "fetch-mock";

import { getStore } from "__support__/entities-store";
import { setupCustomVizPluginRuntimesEndpoint } from "__support__/server-mocks";
import { Api } from "metabase/api";
import { visualizations } from "metabase/viz-core";

import { loadScript } from "./load-script";
import { loadCustomVizPlugin, loadCustomVizPluginForDisplay } from "./loader";
import {
  EXAMPLE_BUNDLE_SOURCE,
  createRuntimePlugin,
  mockBundles,
} from "./test-utils";

jest.mock("./load-script", () => ({ loadScript: jest.fn() }));

const DISPLAY = "custom:progress-ring";

const BROKEN_BUNDLE_SOURCE = `/* metabase-custom-viz
{"apiVersion": 1, "identifier": "broken-viz", "name": "Broken viz"}
*/
window.brokenVizLoaded = true;
`;

const INVALID_DEFINITION_SOURCE = `/* metabase-custom-viz
{"apiVersion": 1, "identifier": "shapeless-viz", "name": "Shapeless viz"}
*/
window.MetabaseCustomViz.define("shapeless-viz", { render: function () {} });
`;

function setupStore() {
  return getStore({ [Api.reducerPath]: Api.reducer }, {}, [Api.middleware]);
}

describe("loadCustomVizPlugin", () => {
  afterEach(() => {
    visualizations.delete(DISPLAY);
    jest.mocked(loadScript).mockReset();
  });

  it("runs the bundle and registers its visualization", async () => {
    const plugin = createRuntimePlugin(EXAMPLE_BUNDLE_SOURCE, "a1");
    mockBundles({ [plugin.bundle_url]: EXAMPLE_BUNDLE_SOURCE });

    expect(await loadCustomVizPlugin(plugin)).toBe(DISPLAY);

    const visualization = visualizations.get(DISPLAY);
    expect(visualization?.identifier).toBe(DISPLAY);
    expect(visualization?.getUiName()).toBe("Progress ring");
    expect(visualization?.iconName).toBe("progress");
    expect(loadScript).toHaveBeenCalledWith(
      "/api/custom-viz-plugin/1/bundle?v=a1",
    );
  });

  it("runs each version of a bundle once", async () => {
    const plugin = createRuntimePlugin(EXAMPLE_BUNDLE_SOURCE, "b1");
    mockBundles({ [plugin.bundle_url]: EXAMPLE_BUNDLE_SOURCE });

    await Promise.all([
      loadCustomVizPlugin(plugin),
      loadCustomVizPlugin(plugin),
    ]);
    await loadCustomVizPlugin(plugin);

    expect(loadScript).toHaveBeenCalledTimes(1);
  });

  it("registers a replaced bundle in place of the previous version", async () => {
    const plugin = createRuntimePlugin(EXAMPLE_BUNDLE_SOURCE, "c1");
    const replaced = createRuntimePlugin(EXAMPLE_BUNDLE_SOURCE, "c2", {
      display_name: "Progress ring 2",
    });
    mockBundles({
      [plugin.bundle_url]: EXAMPLE_BUNDLE_SOURCE,
      [replaced.bundle_url]: EXAMPLE_BUNDLE_SOURCE,
    });

    await loadCustomVizPlugin(plugin);
    expect(await loadCustomVizPlugin(replaced)).toBe(DISPLAY);

    expect(visualizations.get(DISPLAY)?.getUiName()).toBe("Progress ring 2");
    expect(loadScript).toHaveBeenCalledTimes(2);
  });

  it("reports a bundle that doesn't define its visualization, once", async () => {
    const plugin = createRuntimePlugin(BROKEN_BUNDLE_SOURCE, "d1");
    mockBundles({ [plugin.bundle_url]: BROKEN_BUNDLE_SOURCE });
    const onMessage = jest.fn();

    expect(await loadCustomVizPlugin(plugin, { onMessage })).toBeNull();
    expect(await loadCustomVizPlugin(plugin, { onMessage })).toBeNull();

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith({
      variant: "negative",
      message:
        "The custom visualization “Broken viz” couldn't be loaded: The bundle didn't call MetabaseCustomViz.define(\"broken-viz\", …).",
    });
    expect(visualizations.has("custom:broken-viz")).toBe(false);
  });

  it("reports a definition without a mount function", async () => {
    const plugin = createRuntimePlugin(INVALID_DEFINITION_SOURCE, "e1");
    mockBundles({ [plugin.bundle_url]: INVALID_DEFINITION_SOURCE });
    const onMessage = jest.fn();

    expect(await loadCustomVizPlugin(plugin, { onMessage })).toBeNull();
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "must pass an object with a mount function",
        ),
      }),
    );
  });

  it("doesn't run a bundle whose manifest it can't use", async () => {
    const plugin = createRuntimePlugin(EXAMPLE_BUNDLE_SOURCE, "f1", {
      manifest: { name: "Progress ring" },
    });
    const onMessage = jest.fn();

    expect(await loadCustomVizPlugin(plugin, { onMessage })).toBeNull();
    expect(loadScript).not.toHaveBeenCalled();
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("API version"),
      }),
    );
  });

  it("reports a bundle that can't be downloaded", async () => {
    const plugin = createRuntimePlugin(EXAMPLE_BUNDLE_SOURCE, "g1");
    mockBundles({});
    const onMessage = jest.fn();

    expect(await loadCustomVizPlugin(plugin, { onMessage })).toBeNull();
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("couldn't be downloaded"),
      }),
    );
  });
});

describe("loadCustomVizPluginForDisplay", () => {
  afterEach(() => {
    visualizations.delete(DISPLAY);
    jest.mocked(loadScript).mockReset();
  });

  it("loads the enabled plugin behind a display", async () => {
    const plugin = createRuntimePlugin(EXAMPLE_BUNDLE_SOURCE, "h1");
    setupCustomVizPluginRuntimesEndpoint([plugin]);
    mockBundles({ [plugin.bundle_url]: EXAMPLE_BUNDLE_SOURCE });
    const store = setupStore();

    expect(
      await loadCustomVizPluginForDisplay(store.dispatch, DISPLAY),
    ).toEqual({ status: "loaded", display: DISPLAY });
    expect(visualizations.has(DISPLAY)).toBe(true);
  });

  it("doesn't fetch anything for a registered display", async () => {
    const plugin = createRuntimePlugin(EXAMPLE_BUNDLE_SOURCE, "i1");
    mockBundles({ [plugin.bundle_url]: EXAMPLE_BUNDLE_SOURCE });
    await loadCustomVizPlugin(plugin);
    const store = setupStore();

    expect(
      await loadCustomVizPluginForDisplay(store.dispatch, DISPLAY),
    ).toEqual({ status: "loaded", display: DISPLAY });
    expect(
      fetchMock.callHistory.called("path:/api/custom-viz-plugin/list"),
    ).toBe(false);
  });

  it("reports a display whose plugin isn't installed or enabled", async () => {
    setupCustomVizPluginRuntimesEndpoint([]);
    const store = setupStore();

    expect(
      await loadCustomVizPluginForDisplay(store.dispatch, "custom:egret"),
    ).toEqual({ status: "unavailable" });
    expect(await loadCustomVizPluginForDisplay(store.dispatch, "bar")).toEqual({
      status: "unavailable",
    });
  });

  it("reports an error when the plugin list can't be loaded", async () => {
    fetchMock.get("path:/api/custom-viz-plugin/list", 500);
    const store = setupStore();

    expect(
      await loadCustomVizPluginForDisplay(store.dispatch, DISPLAY),
    ).toEqual({ status: "error" });
  });
});
