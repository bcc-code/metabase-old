import { Api } from "metabase/api";
import type {
  ApplicationPermissionsGraph,
  UpdateApplicationPermissionsGraphRequest,
} from "metabase-types/api";

export const applicationPermissionsApi = Api.injectEndpoints({
  endpoints: (builder) => ({
    getApplicationPermissionsGraph: builder.query<
      ApplicationPermissionsGraph,
      void
    >({
      query: () => ({
        method: "GET",
        url: "/api/permissions/application/graph",
      }),
    }),
    updateApplicationPermissionsGraph: builder.mutation<
      ApplicationPermissionsGraph,
      UpdateApplicationPermissionsGraphRequest
    >({
      query: (body) => ({
        method: "PUT",
        url: "/api/permissions/application/graph",
        body,
      }),
      async onQueryStarted(_request, { dispatch, queryFulfilled }) {
        try {
          const { data: graph } = await queryFulfilled;
          dispatch(
            applicationPermissionsApi.util.upsertQueryData(
              "getApplicationPermissionsGraph",
              undefined,
              graph,
            ),
          );
        } catch {
          // the caller reports the error; the graph it read is unchanged
        }
      },
    }),
  }),
});

export const {
  useGetApplicationPermissionsGraphQuery,
  useUpdateApplicationPermissionsGraphMutation,
} = applicationPermissionsApi;
