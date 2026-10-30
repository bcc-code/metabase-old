import type {
  CreateCustomVizPluginRequest,
  CustomVizPlugin,
  CustomVizPluginId,
  CustomVizPluginRuntime,
  ReplaceCustomVizPluginBundleRequest,
  UpdateCustomVizPluginRequest,
} from "metabase-types/api";

import { Api } from "./api";
import { idTag, invalidateTags, listTag } from "./tags";

function bundleFormData(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return formData;
}

export const customVizPluginApi = Api.injectEndpoints({
  endpoints: (builder) => ({
    listCustomVizPlugins: builder.query<CustomVizPlugin[], void>({
      query: () => ({
        method: "GET",
        url: "/api/custom-viz-plugin",
      }),
      providesTags: (plugins = []) => [
        listTag("custom-viz-plugin"),
        ...plugins.map((plugin) => idTag("custom-viz-plugin", plugin.id)),
      ],
    }),
    getCustomVizPlugin: builder.query<CustomVizPlugin, CustomVizPluginId>({
      query: (id) => ({
        method: "GET",
        url: `/api/custom-viz-plugin/${id}`,
      }),
      providesTags: (plugin) =>
        plugin ? [idTag("custom-viz-plugin", plugin.id)] : [],
    }),
    listCustomVizPluginRuntimes: builder.query<CustomVizPluginRuntime[], void>({
      query: () => ({
        method: "GET",
        url: "/api/custom-viz-plugin/list",
        // Signed-out viewers, e.g. of a public dashboard, get a 401 here; it
        // must not send them to the login page.
        noEvent: true,
      }),
      providesTags: [listTag("custom-viz-plugin")],
    }),
    createCustomVizPlugin: builder.mutation<
      CustomVizPlugin,
      CreateCustomVizPluginRequest
    >({
      query: ({ file }) => ({
        method: "POST",
        url: "/api/custom-viz-plugin",
        body: bundleFormData(file),
      }),
      invalidatesTags: (_, error) =>
        invalidateTags(error, [listTag("custom-viz-plugin")]),
    }),
    replaceCustomVizPluginBundle: builder.mutation<
      CustomVizPlugin,
      ReplaceCustomVizPluginBundleRequest
    >({
      query: ({ id, file }) => ({
        method: "PUT",
        url: `/api/custom-viz-plugin/${id}/bundle`,
        body: bundleFormData(file),
      }),
      invalidatesTags: (_, error, { id }) =>
        invalidateTags(error, [
          listTag("custom-viz-plugin"),
          idTag("custom-viz-plugin", id),
        ]),
    }),
    updateCustomVizPlugin: builder.mutation<
      CustomVizPlugin,
      UpdateCustomVizPluginRequest
    >({
      query: ({ id, ...body }) => ({
        method: "PUT",
        url: `/api/custom-viz-plugin/${id}`,
        body,
      }),
      invalidatesTags: (_, error, { id }) =>
        invalidateTags(error, [
          listTag("custom-viz-plugin"),
          idTag("custom-viz-plugin", id),
        ]),
    }),
    deleteCustomVizPlugin: builder.mutation<void, CustomVizPluginId>({
      query: (id) => ({
        method: "DELETE",
        url: `/api/custom-viz-plugin/${id}`,
      }),
      invalidatesTags: (_, error, id) =>
        invalidateTags(error, [
          listTag("custom-viz-plugin"),
          idTag("custom-viz-plugin", id),
        ]),
    }),
  }),
});

export const {
  useListCustomVizPluginsQuery,
  useGetCustomVizPluginQuery,
  useListCustomVizPluginRuntimesQuery,
  useCreateCustomVizPluginMutation,
  useReplaceCustomVizPluginBundleMutation,
  useUpdateCustomVizPluginMutation,
  useDeleteCustomVizPluginMutation,
} = customVizPluginApi;
