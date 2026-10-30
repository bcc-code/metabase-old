import { Api } from "metabase/api";
import type { DatabaseId, GroupId, Impersonation } from "metabase-types/api";

export type ListImpersonationsRequest = {
  "group-id": GroupId;
  "db-id": DatabaseId;
};

export const impersonationApi = Api.injectEndpoints({
  endpoints: (builder) => ({
    listImpersonations: builder.query<
      Impersonation[],
      ListImpersonationsRequest
    >({
      query: (params) => ({
        method: "GET",
        url: "/api/mt/impersonation",
        params,
      }),
    }),
  }),
});

export const { useListImpersonationsQuery } = impersonationApi;
