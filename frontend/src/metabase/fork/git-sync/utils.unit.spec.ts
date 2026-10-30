import { createMockGitSyncTask } from "metabase-types/api/mocks";

import {
  getEntityIcon,
  getTaskInitiatorName,
  getTaskOutcomeMessage,
} from "./utils";

describe("getTaskOutcomeMessage", () => {
  it.each([
    [
      createMockGitSyncTask({
        outcome: { kind: "pushed", count: 1, branch: "main" },
      }),
      "Exported 1 change to main.",
    ],
    [
      createMockGitSyncTask({ outcome: { kind: "push-skipped" } }),
      "Nothing to export: the branch already has every change.",
    ],
    [
      createMockGitSyncTask({
        sync_task_type: "import",
        outcome: { kind: "pulled", count: 3, branch: "prod" },
      }),
      "Imported 3 items from prod.",
    ],
    [
      createMockGitSyncTask({
        sync_task_type: "import",
        outcome: { kind: "pull-skipped" },
      }),
      "Already up to date with the branch.",
    ],
    [
      createMockGitSyncTask({
        status: "running",
        sync_task_type: "import",
        outcome: null,
      }),
      "Importing from Git…",
    ],
    [
      createMockGitSyncTask({
        status: "errored",
        outcome: null,
        error_message: "Boom",
      }),
      "Boom",
    ],
    [
      createMockGitSyncTask({
        status: "errored",
        outcome: null,
        error_message: null,
      }),
      "The sync failed.",
    ],
  ])("describes the task", (task, message) => {
    expect(getTaskOutcomeMessage(task)).toBe(message);
  });

  it("describes conflicts", () => {
    expect(
      getTaskOutcomeMessage(
        createMockGitSyncTask({
          status: "conflict",
          outcome: { kind: "remote-changed" },
        }),
      ),
    ).toMatch(/The branch has changes that aren't imported here yet/);
    expect(
      getTaskOutcomeMessage(
        createMockGitSyncTask({
          status: "conflict",
          outcome: { kind: "local-changes" },
        }),
      ),
    ).toMatch(/Synced content changed here since the last sync/);
  });
});

describe("getTaskInitiatorName", () => {
  it("names the person, falling back to their email", () => {
    expect(
      getTaskInitiatorName({
        id: 1,
        first_name: "Ada",
        last_name: null,
        email: "ada@example.com",
      }),
    ).toBe("Ada");
    expect(
      getTaskInitiatorName({
        id: 1,
        first_name: null,
        last_name: null,
        email: "ada@example.com",
      }),
    ).toBe("ada@example.com");
  });

  it("calls a task without a person a scheduled import", () => {
    expect(getTaskInitiatorName(null)).toBe("Scheduled import");
  });
});

describe("getEntityIcon", () => {
  it("has an icon for every synced kind of entity", () => {
    expect(getEntityIcon("dataset")).toBe("model");
    expect(getEntityIcon("timeline")).toBe("calendar");
    expect(getEntityIcon("nativequerysnippet")).toBe("snippet");
  });
});
