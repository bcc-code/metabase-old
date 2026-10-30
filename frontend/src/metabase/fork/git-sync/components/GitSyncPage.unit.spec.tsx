import userEvent from "@testing-library/user-event";
import fetchMock from "fetch-mock";

import {
  setupGitSyncChangesEndpoint,
  setupGitSyncCollectionsEndpoint,
  setupGitSyncSettingsEndpoint,
  setupGitSyncStatusEndpoint,
  setupTestGitSyncConnectionEndpoint,
  setupUpdateGitSyncCollectionEndpoint,
  setupUpdateGitSyncSettingsEndpoint,
} from "__support__/server-mocks";
import { mockSettings } from "__support__/settings";
import { createMockState } from "__support__/state";
import { renderWithProviders, screen, waitFor, within } from "__support__/ui";
import type {
  GitSyncChange,
  GitSyncCollection,
  GitSyncSettings,
} from "metabase-types/api";
import {
  createMockGitSyncChange,
  createMockGitSyncCollection,
  createMockGitSyncSettings,
  createMockGitSyncStatus,
  createMockUser,
} from "metabase-types/api/mocks";

import { GitSyncPage } from "./GitSyncPage";

interface SetupOpts {
  isAdmin?: boolean;
  settings?: GitSyncSettings;
  changes?: GitSyncChange[];
  collections?: GitSyncCollection[];
}

const setup = ({
  isAdmin = true,
  settings = createMockGitSyncSettings(),
  changes = [],
  collections = [],
}: SetupOpts = {}) => {
  setupGitSyncSettingsEndpoint(settings);
  setupGitSyncStatusEndpoint(
    createMockGitSyncStatus({
      enabled: settings.enabled,
      branch: settings.branch,
      type: settings.type,
    }),
  );
  setupGitSyncChangesEndpoint(changes);
  setupGitSyncCollectionsEndpoint(collections);

  renderWithProviders(<GitSyncPage />, {
    storeInitialState: createMockState({
      currentUser: createMockUser({ is_superuser: isAdmin }),
      settings: mockSettings({
        "remote-sync-enabled": settings.enabled,
        "remote-sync-type": settings.type,
        "remote-sync-branch": settings.branch,
      }),
    }),
  });
};

const getLastRequestBody = async (name: string): Promise<unknown> => {
  const call = fetchMock.callHistory.lastCall(name);
  return JSON.parse(String(await call?.request?.text()));
};

describe("GitSyncPage", () => {
  it("tells people who aren't admins that only admins can sync", () => {
    setup({ isAdmin: false });
    expect(
      screen.getByText("Only admins can set up Git sync and export or import."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Repository URL")).not.toBeInTheDocument();
  });

  describe("without a repository", () => {
    const settings = createMockGitSyncSettings({
      enabled: false,
      url: null,
      token_set: false,
    });

    it("only shows the repository form", async () => {
      setup({ settings });
      expect(await screen.findByLabelText("Repository URL")).toHaveValue("");
      expect(screen.queryByText("Sync")).not.toBeInTheDocument();
      expect(screen.queryByText("Synced collections")).not.toBeInTheDocument();
    });

    it("connects a repository and reports its branches", async () => {
      setup({ settings });
      setupUpdateGitSyncSettingsEndpoint({
        settings: createMockGitSyncSettings({
          url: "https://git.example.com/content.git",
        }),
        check: { branches: ["develop"], branch_exists: false },
      });

      await userEvent.type(
        await screen.findByLabelText("Repository URL"),
        "https://git.example.com/content.git",
      );
      await userEvent.type(screen.getByLabelText("Access token"), "secret");
      await userEvent.click(screen.getByLabelText("Only imports from Git"));
      await userEvent.click(screen.getByRole("button", { name: "Connect" }));

      await waitFor(async () =>
        expect(await getLastRequestBody("git-sync-settings-put")).toEqual({
          url: "https://git.example.com/content.git",
          branch: "main",
          token: "secret",
          type: "read-only",
          auto_import: false,
          auto_import_interval: 15,
          author_name: null,
          author_email: null,
        }),
      );
    });

    it("shows why the repository couldn't be connected", async () => {
      setup({ settings });
      setupUpdateGitSyncSettingsEndpoint({
        status: 400,
        body: "Git operation failed: not authorized",
      });

      await userEvent.type(
        await screen.findByLabelText("Repository URL"),
        "https://git.example.com/content.git",
      );
      await userEvent.click(screen.getByRole("button", { name: "Connect" }));

      expect(
        await screen.findByText("Git operation failed: not authorized"),
      ).toBeInTheDocument();
    });

    it("tests the connection with the values in the form", async () => {
      setup({ settings });
      setupTestGitSyncConnectionEndpoint({
        branches: ["main", "release"],
        branch_exists: true,
      });

      await userEvent.type(
        await screen.findByLabelText("Repository URL"),
        "https://git.example.com/content.git",
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Test connection" }),
      );

      expect(
        await screen.findByText("Connected. Branches: main, release."),
      ).toBeInTheDocument();
      expect(await getLastRequestBody("git-sync-test-connection")).toEqual({
        url: "https://git.example.com/content.git",
        branch: "main",
      });
    });

    it("shows why the connection test failed", async () => {
      setup({ settings });
      setupTestGitSyncConnectionEndpoint({
        status: 400,
        body: "Git operation failed: repository not found",
      });

      await userEvent.type(
        await screen.findByLabelText("Repository URL"),
        "https://git.example.com/missing.git",
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Test connection" }),
      );

      expect(
        await screen.findByText("Git operation failed: repository not found"),
      ).toBeInTheDocument();
    });
  });

  describe("with a repository", () => {
    it("shows the sync status, local changes and collections", async () => {
      setup({
        changes: [
          createMockGitSyncChange({ name: "Orders", sync_status: "update" }),
          createMockGitSyncChange({
            id: 2,
            name: "Revenue",
            model: "dashboard",
            sync_status: "create",
          }),
        ],
        collections: [
          createMockGitSyncCollection({ id: 1, name: "Sales" }),
          createMockGitSyncCollection({
            id: 2,
            name: "Finance",
            is_remote_synced: true,
          }),
        ],
      });

      expect(await screen.findByText("Read-write")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Export" })).toBeEnabled();

      const changes = await screen.findByRole("list", {
        name: "Unsynced changes",
      });
      expect(within(changes).getByText("Orders")).toBeInTheDocument();
      expect(within(changes).getByText("Changed")).toBeInTheDocument();
      expect(within(changes).getByText("Revenue")).toBeInTheDocument();
      expect(within(changes).getByText("New")).toBeInTheDocument();

      expect(await screen.findByLabelText("Sync Sales")).not.toBeChecked();
      expect(screen.getByLabelText("Sync Finance")).toBeChecked();
      expect(screen.getByLabelText("Repository URL")).toHaveValue(
        "https://git.example.com/org/metabase-content.git",
      );
      expect(screen.getByLabelText("Access token")).toHaveAttribute(
        "placeholder",
        "Saved. Leave empty to keep it.",
      );
    });

    it("syncs a collection", async () => {
      setup({
        collections: [createMockGitSyncCollection({ id: 1, name: "Sales" })],
      });
      setupUpdateGitSyncCollectionEndpoint(
        1,
        createMockGitSyncCollection({ id: 1, is_remote_synced: true }),
      );

      await userEvent.click(await screen.findByLabelText("Sync Sales"));

      await waitFor(async () =>
        expect(await getLastRequestBody("git-sync-collection-1")).toEqual({
          synced: true,
        }),
      );
    });

    it("shows why a collection can't be synced", async () => {
      setup({
        collections: [createMockGitSyncCollection({ id: 1, name: "Sales" })],
      });
      setupUpdateGitSyncCollectionEndpoint(1, {
        status: 400,
        body: 'This collection uses content that isn\'t in a synced collection: Card "Base".',
      });

      await userEvent.click(await screen.findByLabelText("Sync Sales"));

      expect(
        await screen.findByText(
          'This collection uses content that isn\'t in a synced collection: Card "Base".',
        ),
      ).toBeInTheDocument();
    });

    it("doesn't export or choose collections on a read-only instance", async () => {
      setup({
        settings: createMockGitSyncSettings({ type: "read-only" }),
        collections: [createMockGitSyncCollection({ id: 1, name: "Sales" })],
      });

      expect(await screen.findByText("Read-only")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Export" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
      expect(await screen.findByLabelText("Sync Sales")).toBeDisabled();
    });

    it("says when nothing changed since the last sync", async () => {
      setup();
      expect(
        await screen.findByText("No changes since the last sync."),
      ).toBeInTheDocument();
    });
  });
});
