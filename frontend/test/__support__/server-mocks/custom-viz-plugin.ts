import fetchMock from "fetch-mock";

import type {
  CustomVizPlugin,
  CustomVizPluginId,
  CustomVizPluginRuntime,
} from "metabase-types/api";

export const setupCustomVizPluginListEndpoint = (
  plugins: CustomVizPluginRuntime[] = [],
) => {
  fetchMock.get("path:/api/ee/custom-viz-plugin/list", plugins);
};

export const setupCustomVizPluginsEndpoint = (
  plugins: CustomVizPlugin[] = [],
) => {
  fetchMock.get("path:/api/custom-viz-plugin", plugins);
};

export const setupCustomVizPluginRuntimesEndpoint = (
  plugins: CustomVizPluginRuntime[] = [],
) => {
  fetchMock.get("path:/api/custom-viz-plugin/list", plugins);
};

export const setupCustomVizPluginEndpoint = (plugin: CustomVizPlugin) => {
  fetchMock.get(`path:/api/custom-viz-plugin/${plugin.id}`, plugin);
};

type CustomVizPluginWriteResponse =
  | CustomVizPlugin
  | { status: number; body: string };

export const setupCreateCustomVizPluginEndpoint = (
  response: CustomVizPluginWriteResponse,
) => {
  fetchMock.post("path:/api/custom-viz-plugin", response);
};

export const setupReplaceCustomVizPluginBundleEndpoint = (
  id: CustomVizPluginId,
  response: CustomVizPluginWriteResponse,
) => {
  fetchMock.put(`path:/api/custom-viz-plugin/${id}/bundle`, response);
};

export const setupUpdateCustomVizPluginEndpoint = (plugin: CustomVizPlugin) => {
  fetchMock.put(`path:/api/custom-viz-plugin/${plugin.id}`, plugin);
};

export const setupDeleteCustomVizPluginEndpoint = (id: CustomVizPluginId) => {
  fetchMock.delete(`path:/api/custom-viz-plugin/${id}`, 204);
};
