import { Api } from "metabase/api";
import { idTag, invalidateTags, listTag, tag } from "metabase/api/tags";
import {
  type ExportGitSyncRequest,
  type GitSyncChange,
  type GitSyncChangesResponse,
  type GitSyncCollection,
  type GitSyncConnectionCheck,
  type GitSyncSettings,
  type GitSyncStatus,
  type GitSyncTask,
  type ImportGitSyncRequest,
  type RemoteSyncChangesResponse,
  type RemoteSyncEntity,
  type TestGitSyncConnectionRequest,
  type UpdateGitSyncCollectionRequest,
  type UpdateGitSyncSettingsRequest,
  type UpdateGitSyncSettingsResponse,
  isCardDisplayType,
} from "metabase-types/api";

const SETTINGS_TAG = idTag("git-sync", "settings");
const STATUS_TAG = idTag("git-sync", "status");
const CHANGES_TAG = idTag("git-sync", "changes");
const COLLECTIONS_TAG = idTag("git-sync", "collections");

/** The tags of what a finished import may have changed. */
export const GIT_SYNC_CONTENT_TAGS = [
  STATUS_TAG,
  CHANGES_TAG,
  COLLECTIONS_TAG,
  tag("collection"),
  tag("collection-tree"),
  tag("card"),
  tag("dashboard"),
  tag("document"),
  tag("snippet"),
  tag("timeline"),
  tag("action"),
];

const toRemoteSyncEntity = ({
  id,
  name,
  model,
  collection_id,
  display,
  sync_status,
}: GitSyncChange): RemoteSyncEntity => ({
  id,
  name: name ?? "",
  model,
  collection_id: collection_id ?? undefined,
  display: isCardDisplayType(display) ? display : undefined,
  sync_status,
});

export const gitSyncApi = Api.injectEndpoints({
  endpoints: (builder) => ({
    getGitSyncSettings: builder.query<GitSyncSettings, void>({
      query: () => ({
        method: "GET",
        url: "/api/remote-sync/settings",
      }),
      providesTags: [SETTINGS_TAG],
    }),
    updateGitSyncSettings: builder.mutation<
      UpdateGitSyncSettingsResponse,
      UpdateGitSyncSettingsRequest
    >({
      query: (body) => ({
        method: "PUT",
        url: "/api/remote-sync/settings",
        body,
      }),
      invalidatesTags: (_, error) =>
        invalidateTags(error, [
          SETTINGS_TAG,
          STATUS_TAG,
          CHANGES_TAG,
          tag("session-properties"),
        ]),
    }),
    disconnectGitSync: builder.mutation<GitSyncSettings, void>({
      query: () => ({
        method: "DELETE",
        url: "/api/remote-sync/settings",
      }),
      invalidatesTags: (_, error) =>
        invalidateTags(error, [
          SETTINGS_TAG,
          STATUS_TAG,
          CHANGES_TAG,
          tag("session-properties"),
        ]),
    }),
    testGitSyncConnection: builder.mutation<
      GitSyncConnectionCheck,
      TestGitSyncConnectionRequest
    >({
      query: (body) => ({
        method: "POST",
        url: "/api/remote-sync/test-connection",
        body,
      }),
    }),
    getGitSyncStatus: builder.query<GitSyncStatus, void>({
      query: () => ({
        method: "GET",
        url: "/api/remote-sync/status",
      }),
      providesTags: [STATUS_TAG],
    }),
    getGitSyncChanges: builder.query<RemoteSyncChangesResponse, void>({
      query: () => ({
        method: "GET",
        url: "/api/remote-sync/changes",
      }),
      transformResponse: ({
        dirty,
        changed_collections,
      }: GitSyncChangesResponse): RemoteSyncChangesResponse => ({
        dirty: dirty.map(toRemoteSyncEntity),
        changedCollections: changed_collections,
      }),
      providesTags: [CHANGES_TAG],
    }),
    exportGitSync: builder.mutation<GitSyncTask, ExportGitSyncRequest>({
      query: (body) => ({
        method: "POST",
        url: "/api/remote-sync/export",
        body,
      }),
      invalidatesTags: (_, error) => invalidateTags(error, [STATUS_TAG]),
    }),
    importGitSync: builder.mutation<GitSyncTask, ImportGitSyncRequest>({
      query: (body) => ({
        method: "POST",
        url: "/api/remote-sync/import",
        body,
      }),
      invalidatesTags: (_, error) => invalidateTags(error, [STATUS_TAG]),
    }),
    listGitSyncCollections: builder.query<GitSyncCollection[], void>({
      query: () => ({
        method: "GET",
        url: "/api/remote-sync/collections",
      }),
      providesTags: [COLLECTIONS_TAG],
    }),
    updateGitSyncCollection: builder.mutation<
      GitSyncCollection,
      UpdateGitSyncCollectionRequest
    >({
      query: ({ id, synced }) => ({
        method: "PUT",
        url: `/api/remote-sync/collection/${id}`,
        body: { synced },
      }),
      invalidatesTags: (_, error) =>
        invalidateTags(error, [
          COLLECTIONS_TAG,
          CHANGES_TAG,
          listTag("collection"),
          tag("collection"),
          tag("collection-tree"),
        ]),
    }),
  }),
});

export const {
  useGetGitSyncSettingsQuery,
  useUpdateGitSyncSettingsMutation,
  useDisconnectGitSyncMutation,
  useTestGitSyncConnectionMutation,
  useGetGitSyncStatusQuery,
  useGetGitSyncChangesQuery,
  useExportGitSyncMutation,
  useImportGitSyncMutation,
  useListGitSyncCollectionsQuery,
  useUpdateGitSyncCollectionMutation,
} = gitSyncApi;
