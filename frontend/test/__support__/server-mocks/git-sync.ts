import fetchMock from "fetch-mock";

import type {
  GitSyncChange,
  GitSyncCollection,
  GitSyncConnectionCheck,
  GitSyncSettings,
  GitSyncStatus,
  GitSyncTask,
} from "metabase-types/api";

type ErrorResponse = { status: number; body: unknown };

export function setupGitSyncSettingsEndpoint(settings: GitSyncSettings) {
  fetchMock.removeRoute("git-sync-settings");
  fetchMock.get("path:/api/remote-sync/settings", settings, {
    name: "git-sync-settings",
  });
}

export function setupUpdateGitSyncSettingsEndpoint(
  response:
    | { settings: GitSyncSettings; check: GitSyncConnectionCheck }
    | ErrorResponse,
) {
  fetchMock.removeRoute("git-sync-settings-put");
  fetchMock.put(
    "path:/api/remote-sync/settings",
    "settings" in response
      ? { ...response.check, settings: response.settings }
      : response,
    { name: "git-sync-settings-put" },
  );
}

export function setupDisconnectGitSyncEndpoint(settings: GitSyncSettings) {
  fetchMock.removeRoute("git-sync-settings-delete");
  fetchMock.delete("path:/api/remote-sync/settings", settings, {
    name: "git-sync-settings-delete",
  });
}

export function setupTestGitSyncConnectionEndpoint(
  response: GitSyncConnectionCheck | ErrorResponse,
) {
  fetchMock.removeRoute("git-sync-test-connection");
  fetchMock.post("path:/api/remote-sync/test-connection", response, {
    name: "git-sync-test-connection",
  });
}

export function setupGitSyncStatusEndpoint(status: GitSyncStatus) {
  fetchMock.removeRoute("git-sync-status");
  fetchMock.get("path:/api/remote-sync/status", status, {
    name: "git-sync-status",
  });
}

export function setupGitSyncChangesEndpoint(
  dirty: GitSyncChange[] = [],
  changedCollections: Record<number, boolean> = {},
) {
  fetchMock.removeRoute("git-sync-changes");
  fetchMock.get(
    "path:/api/remote-sync/changes",
    { dirty, changed_collections: changedCollections },
    { name: "git-sync-changes" },
  );
}

export function setupGitSyncExportEndpoint(
  response: GitSyncTask | ErrorResponse,
) {
  fetchMock.removeRoute("git-sync-export");
  fetchMock.post("path:/api/remote-sync/export", response, {
    name: "git-sync-export",
  });
}

export function setupGitSyncImportEndpoint(
  response: GitSyncTask | ErrorResponse,
) {
  fetchMock.removeRoute("git-sync-import");
  fetchMock.post("path:/api/remote-sync/import", response, {
    name: "git-sync-import",
  });
}

export function setupGitSyncCollectionsEndpoint(
  collections: GitSyncCollection[],
) {
  fetchMock.removeRoute("git-sync-collections");
  fetchMock.get("path:/api/remote-sync/collections", collections, {
    name: "git-sync-collections",
  });
}

export function setupUpdateGitSyncCollectionEndpoint(
  id: number,
  response: GitSyncCollection | ErrorResponse,
) {
  const name = `git-sync-collection-${id}`;
  fetchMock.removeRoute(name);
  fetchMock.put(`path:/api/remote-sync/collection/${id}`, response, { name });
}
