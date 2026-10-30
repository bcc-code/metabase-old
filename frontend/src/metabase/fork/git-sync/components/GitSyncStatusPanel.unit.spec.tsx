import userEvent from "@testing-library/user-event";
import fetchMock from "fetch-mock";

import {
  setupGitSyncExportEndpoint,
  setupGitSyncImportEndpoint,
  setupGitSyncStatusEndpoint,
} from "__support__/server-mocks";
import { mockSettings } from "__support__/settings";
import { createMockState } from "__support__/state";
import { renderWithProviders, screen, waitFor, within } from "__support__/ui";
import type { GitSyncStatus } from "metabase-types/api";
import {
  createMockGitSyncStatus,
  createMockGitSyncTask,
  createMockUser,
} from "metabase-types/api/mocks";

import { GitSyncStatusPanel } from "./GitSyncStatusPanel";

interface SetupOpts {
  status: GitSyncStatus;
}

const setup = ({ status }: SetupOpts) => {
  setupGitSyncStatusEndpoint(status);
  setupGitSyncExportEndpoint(
    createMockGitSyncTask({ status: "running", ended_at: null }),
  );
  setupGitSyncImportEndpoint(
    createMockGitSyncTask({
      sync_task_type: "import",
      status: "running",
      ended_at: null,
    }),
  );

  renderWithProviders(<GitSyncStatusPanel />, {
    storeInitialState: createMockState({
      currentUser: createMockUser({ is_superuser: true }),
      settings: mockSettings({
        "remote-sync-enabled": true,
        "remote-sync-type": status.type,
        "remote-sync-branch": status.branch,
      }),
    }),
  });
};

const getLastRequestBody = async (name: string): Promise<unknown> => {
  const call = fetchMock.callHistory.lastCall(name);
  return JSON.parse(String(await call?.request?.text()));
};

describe("GitSyncStatusPanel", () => {
  it("shows the branch, the last sync and the latest outcome", async () => {
    setup({
      status: createMockGitSyncStatus({
        last_synced_commit: "0123456789abcdef0123456789abcdef01234567",
        last_export: createMockGitSyncTask(),
        latest_task: createMockGitSyncTask(),
      }),
    });

    expect(await screen.findByText("main")).toBeInTheDocument();
    expect(screen.getByText("Last synced commit: 0123456")).toBeInTheDocument();
    expect(
      screen.getByText(/Last export: .* \(Bobby Tables\)/),
    ).toBeInTheDocument();
    expect(screen.getByText("Exported 2 changes to main.")).toBeInTheDocument();
  });

  it("exports with a commit message", async () => {
    setup({ status: createMockGitSyncStatus() });

    await userEvent.click(
      await screen.findByRole("button", { name: "Export" }),
    );
    const modal = await screen.findByRole("dialog");
    await userEvent.type(
      within(modal).getByLabelText("Commit message"),
      "Add the sales dashboard",
    );
    await userEvent.click(
      within(modal).getByRole("button", { name: "Export" }),
    );

    await waitFor(async () =>
      expect(await getLastRequestBody("git-sync-export")).toEqual({
        message: "Add the sales dashboard",
        force: false,
      }),
    );
  });

  it("imports", async () => {
    setup({ status: createMockGitSyncStatus() });

    await userEvent.click(
      await screen.findByRole("button", { name: "Import" }),
    );

    await waitFor(async () =>
      expect(await getLastRequestBody("git-sync-import")).toEqual({
        force: false,
      }),
    );
  });

  it("shows the progress of a running task and blocks starting another", async () => {
    setup({
      status: createMockGitSyncStatus({
        current_task: createMockGitSyncTask({
          sync_task_type: "import",
          status: "running",
          progress: 0.4,
          ended_at: null,
        }),
      }),
    });

    expect(await screen.findByText("Importing from Git…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });

  it("offers to export anyway when the branch changed", async () => {
    setup({
      status: createMockGitSyncStatus({
        latest_task: createMockGitSyncTask({
          status: "conflict",
          outcome: { kind: "remote-changed" },
          error_message: "The branch main has changes",
          conflicts: ["collections/abc_sales/cards/def_orders.yaml"],
        }),
      }),
    });

    expect(
      await screen.findByText(/The branch has changes that aren't imported/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("collections/abc_sales/cards/def_orders.yaml"),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Export anyway" }),
    );
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Export anyway",
      }),
    );

    await waitFor(async () =>
      expect(await getLastRequestBody("git-sync-export")).toEqual({
        force: true,
      }),
    );
  });

  it("offers to discard local changes when they block an import", async () => {
    setup({
      status: createMockGitSyncStatus({
        latest_task: createMockGitSyncTask({
          sync_task_type: "import",
          status: "conflict",
          outcome: { kind: "local-changes" },
          conflicts: ["Changed card: Orders"],
        }),
      }),
    });

    expect(await screen.findByText("Changed card: Orders")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Discard local changes and import" }),
    );
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Discard and import",
      }),
    );

    await waitFor(async () =>
      expect(await getLastRequestBody("git-sync-import")).toEqual({
        force: true,
      }),
    );
  });

  it("shows why a task failed", async () => {
    setup({
      status: createMockGitSyncStatus({
        latest_task: createMockGitSyncTask({
          status: "errored",
          outcome: null,
          error_message: "Git operation failed: not authorized",
        }),
      }),
    });

    expect(
      await screen.findByText("Git operation failed: not authorized"),
    ).toBeInTheDocument();
  });

  it("shows why a task couldn't start", async () => {
    setup({ status: createMockGitSyncStatus() });
    setupGitSyncImportEndpoint({
      status: 409,
      body: "Another Git sync export or import is running.",
    });

    await userEvent.click(
      await screen.findByRole("button", { name: "Import" }),
    );

    expect(
      await screen.findByText("Another Git sync export or import is running."),
    ).toBeInTheDocument();
  });
});
