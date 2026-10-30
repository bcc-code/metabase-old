import {
  setupGitSyncChangesEndpoint,
  setupGitSyncStatusEndpoint,
} from "__support__/server-mocks";
import { mockSettings } from "__support__/settings";
import { createMockState } from "__support__/state";
import { renderWithProviders, screen, within } from "__support__/ui";
import type { CollectionTreeItem } from "metabase/common/collections/utils";
import { PLUGIN_REMOTE_SYNC, reinitialize } from "metabase/plugins";
import type { EnterpriseSettings } from "metabase-types/api";
import {
  createMockCollection,
  createMockGitSyncChange,
  createMockGitSyncStatus,
  createMockGitSyncTask,
  createMockUser,
} from "metabase-types/api/mocks";

import { initializeGitSyncPlugin } from "./index";

interface StateOpts {
  isAdmin?: boolean;
  settings?: Partial<EnterpriseSettings>;
}

const getState = ({ isAdmin = true, settings = {} }: StateOpts = {}) =>
  createMockState({
    currentUser: createMockUser({ is_superuser: isAdmin }),
    settings: mockSettings({
      "remote-sync-enabled": true,
      "remote-sync-branch": "main",
      "remote-sync-type": "read-write",
      ...settings,
    }),
  });

const createTreeItem = (
  opts: Partial<CollectionTreeItem>,
): CollectionTreeItem => ({
  ...createMockCollection(opts),
  icon: { name: "folder" },
  children: [],
  ...opts,
});

describe("Git sync plugin", () => {
  beforeEach(() => {
    initializeGitSyncPlugin();
  });

  afterEach(() => {
    reinitialize();
  });

  it("enables the remote sync plugin slot", () => {
    expect(PLUGIN_REMOTE_SYNC.isEnabled).toBe(true);
    expect(PLUGIN_REMOTE_SYNC.CollectionsNavTree).not.toBeNull();
    expect(PLUGIN_REMOTE_SYNC.CollectionSyncStatusBadge).not.toBeNull();
  });

  describe("getIsRemoteSyncReadOnly", () => {
    it("is true on a read-only instance with a repository", () => {
      expect(
        PLUGIN_REMOTE_SYNC.getIsRemoteSyncReadOnly(
          getState({ settings: { "remote-sync-type": "read-only" } }),
        ),
      ).toBe(true);
    });

    it("is false on a read-write instance", () => {
      expect(PLUGIN_REMOTE_SYNC.getIsRemoteSyncReadOnly(getState())).toBe(
        false,
      );
    });

    it("is false without a repository, whatever the mode", () => {
      expect(
        PLUGIN_REMOTE_SYNC.getIsRemoteSyncReadOnly(
          getState({
            settings: {
              "remote-sync-enabled": false,
              "remote-sync-type": "read-only",
            },
          }),
        ),
      ).toBe(false);
    });
  });

  describe("GitSyncAppBarControls", () => {
    it("shows the branch to admins, with a dot for local changes", async () => {
      setupGitSyncChangesEndpoint([createMockGitSyncChange()], { 1: true });
      renderWithProviders(<PLUGIN_REMOTE_SYNC.GitSyncAppBarControls />, {
        storeInitialState: getState(),
      });

      const controls = await screen.findByTestId("git-sync-controls");
      expect(within(controls).getByText("main")).toBeInTheDocument();
      expect(
        await within(controls).findByLabelText(
          "Changed since the last Git sync",
        ),
      ).toBeInTheDocument();
    });

    it("is hidden from people who aren't admins", () => {
      renderWithProviders(<PLUGIN_REMOTE_SYNC.GitSyncAppBarControls />, {
        storeInitialState: getState({ isAdmin: false }),
      });
      expect(screen.queryByTestId("git-sync-controls")).not.toBeInTheDocument();
    });
  });

  describe("CollectionsNavTree", () => {
    it("marks synced collections and those with local changes", async () => {
      const CollectionsNavTree = PLUGIN_REMOTE_SYNC.CollectionsNavTree;
      if (!CollectionsNavTree) {
        throw new Error("CollectionsNavTree is not set");
      }
      setupGitSyncChangesEndpoint([createMockGitSyncChange()], { 1: true });

      renderWithProviders(
        <CollectionsNavTree
          collections={[
            createTreeItem({ id: 1, name: "Sales", is_remote_synced: true }),
            createTreeItem({ id: 2, name: "Scratch" }),
          ]}
        />,
        { storeInitialState: getState(), withDND: true, withRouter: true },
      );

      const [sales, scratch] = screen.getAllByRole("treeitem");
      expect(within(sales).getByText("Sales")).toBeInTheDocument();
      expect(
        within(sales).getByLabelText("Synced with Git"),
      ).toBeInTheDocument();
      expect(
        await within(sales).findByLabelText("Changed since the last Git sync"),
      ).toBeInTheDocument();
      expect(within(scratch).getByText("Scratch")).toBeInTheDocument();
      expect(
        within(scratch).queryByLabelText("Synced with Git"),
      ).not.toBeInTheDocument();
    });
  });

  describe("useSyncStatus", () => {
    function SyncStatus() {
      const { progressModal, isIdle } = PLUGIN_REMOTE_SYNC.useSyncStatus();
      return (
        <>
          <span>{isIdle ? "idle" : "busy"}</span>
          {progressModal}
        </>
      );
    }

    it("shows the progress of a running export", async () => {
      setupGitSyncStatusEndpoint(
        createMockGitSyncStatus({
          current_task: createMockGitSyncTask({
            status: "running",
            progress: 0.5,
            ended_at: null,
          }),
        }),
      );
      renderWithProviders(<SyncStatus />, { storeInitialState: getState() });

      expect(await screen.findByText("busy")).toBeInTheDocument();
      expect(
        within(screen.getByRole("status")).getByText("Exporting to Git…"),
      ).toBeInTheDocument();
    });

    it("is idle when nothing runs", async () => {
      setupGitSyncStatusEndpoint(createMockGitSyncStatus());
      renderWithProviders(<SyncStatus />, { storeInitialState: getState() });

      expect(await screen.findByText("idle")).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });
});
