import { Api } from "metabase/api";
import { invalidateTags, tag } from "metabase/api/tags";
import type {
  JwtSsoSettings,
  OidcConnectionCheck,
  OidcConnectionCheckRequest,
  OidcSsoInfo,
  OidcSsoSettings,
} from "metabase-types/api";

export const ssoApi = Api.injectEndpoints({
  endpoints: (builder) => ({
    getOidcSsoInfo: builder.query<OidcSsoInfo, void>({
      query: () => ({
        method: "GET",
        url: "/api/sso/oidc",
      }),
    }),
    updateOidcSsoSettings: builder.mutation<
      { "oidc-enabled": boolean },
      OidcSsoSettings
    >({
      query: (settings) => ({
        method: "PUT",
        url: "/api/sso/oidc/settings",
        body: settings,
      }),
      invalidatesTags: (_, error) =>
        invalidateTags(error, [tag("session-properties")]),
    }),
    checkOidcConnection: builder.mutation<
      OidcConnectionCheck,
      OidcConnectionCheckRequest
    >({
      query: (body) => ({
        method: "POST",
        url: "/api/sso/oidc/check",
        body,
      }),
    }),
    updateJwtSsoSettings: builder.mutation<
      { "jwt-enabled": boolean },
      JwtSsoSettings
    >({
      query: (settings) => ({
        method: "PUT",
        url: "/api/sso/jwt/settings",
        body: settings,
      }),
      invalidatesTags: (_, error) =>
        invalidateTags(error, [tag("session-properties")]),
    }),
  }),
});

export const {
  useGetOidcSsoInfoQuery,
  useUpdateOidcSsoSettingsMutation,
  useCheckOidcConnectionMutation,
  useUpdateJwtSsoSettingsMutation,
} = ssoApi;
