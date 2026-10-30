import userEvent from "@testing-library/user-event";
import fetchMock from "fetch-mock";

import {
  setupApplicationPermissionsGraphEndpoints,
  setupGroupsEndpoint,
} from "__support__/server-mocks";
import { mockSettings } from "__support__/settings";
import { createMockState } from "__support__/state";
import { renderWithProviders, screen, waitFor, within } from "__support__/ui";
import { Route } from "metabase/router";
import type {
  ApplicationPermissionsGraph,
  GroupInfo,
} from "metabase-types/api";
import { createMockTokenFeatures } from "metabase-types/api/mocks";

import { ApplicationPermissionsPage } from "./ApplicationPermissionsPage";

const GROUPS: GroupInfo[] = [
  {
    id: 1,
    name: "All Users",
    member_count: 3,
    magic_group_type: "all-internal-users",
  },
  { id: 2, name: "Administrators", member_count: 1, magic_group_type: "admin" },
  { id: 3, name: "Birders", member_count: 2, magic_group_type: null },
];

const GRAPH: ApplicationPermissionsGraph = {
  revision: 7,
  groups: {
    1: { setting: "no", monitoring: "no", subscription: "yes" },
    2: { setting: "yes", monitoring: "yes", subscription: "yes" },
    3: { setting: "no", monitoring: "no", subscription: "no" },
  },
};

interface SetupOpts {
  updateError?: { status: number; message: string };
}

function setup({ updateError }: SetupOpts = {}) {
  setupGroupsEndpoint(GROUPS);
  setupApplicationPermissionsGraphEndpoints({
    graph: GRAPH,
    updatedGraph: {
      revision: 8,
      groups: {
        ...GRAPH.groups,
        3: { setting: "yes", monitoring: "no", subscription: "no" },
      },
    },
    updateError,
  });

  renderWithProviders(
    <Route
      path="/admin/permissions/application"
      element={<ApplicationPermissionsPage />}
    />,
    {
      storeInitialState: createMockState({
        settings: mockSettings({
          "token-features": createMockTokenFeatures({
            advanced_permissions: true,
          }),
        }),
      }),
      withRouter: true,
      withUndos: true,
      initialRoute: "/admin/permissions/application",
    },
  );
}

const getGroupRow = (groupName: string) =>
  screen.findByRole("row", { name: new RegExp(`^${groupName}`) });

async function grantBirdersSettingsAccess() {
  const [settingsAccess] = within(await getGroupRow("Birders")).getAllByTestId(
    "permissions-select",
  );
  await userEvent.click(settingsAccess);
  await userEvent.click(
    within(await screen.findByRole("listbox")).getByText("Yes"),
  );
}

async function saveChanges() {
  await userEvent.click(await screen.findByText("Save changes"));
  await userEvent.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Yes",
    }),
  );
}

async function getLastSavedGraph(): Promise<unknown> {
  const lastCall = fetchMock.callHistory.lastCall(
    "path:/api/permissions/application/graph",
    { method: "PUT" },
  );
  const body = lastCall?.options?.body;
  return typeof body === "string" ? JSON.parse(body) : undefined;
}

describe("ApplicationPermissionsPage", () => {
  it("shows each group's settings, monitoring and subscriptions access", async () => {
    setup();

    expect(
      await screen.findByText("Application settings permissions"),
    ).toBeInTheDocument();
    expect(await screen.findByText("Settings access")).toBeInTheDocument();
    expect(screen.getByText("Monitoring access")).toBeInTheDocument();
    expect(screen.getByText("Subscriptions and alerts")).toBeInTheDocument();

    const allUsersRow = await getGroupRow("All Users");
    expect(
      within(allUsersRow)
        .getAllByTestId("permissions-select")
        .map((select) => select.textContent),
    ).toEqual(["No", "No", "Yes"]);

    const administratorsRow = await getGroupRow("Administrators");
    within(administratorsRow)
      .getAllByTestId("permissions-select")
      .forEach((select) => {
        expect(select).toHaveAttribute("aria-disabled", "true");
      });
  });

  it("saves only the changed permissions", async () => {
    setup();

    await grantBirdersSettingsAccess();
    expect(
      await screen.findByText("You've made changes to permissions."),
    ).toBeInTheDocument();

    await saveChanges();

    expect(await getLastSavedGraph()).toEqual({
      revision: 7,
      groups: { 3: { setting: "yes" } },
    });
    await screen.findByText("Birders");
    expect(
      screen.queryByText("You've made changes to permissions."),
    ).not.toBeInTheDocument();
    expect(
      within(await getGroupRow("Birders"))
        .getAllByTestId("permissions-select")
        .map((select) => select.textContent),
    ).toEqual(["Yes", "No", "No"]);
  });

  it("discards the changes on cancel", async () => {
    setup();

    await grantBirdersSettingsAccess();
    await userEvent.click(await screen.findByText("Cancel"));

    expect(
      screen.queryByText("You've made changes to permissions."),
    ).not.toBeInTheDocument();
    expect(
      within(await getGroupRow("Birders"))
        .getAllByTestId("permissions-select")
        .map((select) => select.textContent),
    ).toEqual(["No", "No", "No"]);
  });

  it("keeps the changes, explains why and reloads the graph when saving fails", async () => {
    setup({
      updateError: {
        status: 409,
        message: "Looks like someone else edited the permissions.",
      },
    });

    await grantBirdersSettingsAccess();
    await saveChanges();

    expect(
      await screen.findByText(
        "Looks like someone else edited the permissions.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("You've made changes to permissions."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        fetchMock.callHistory.calls("path:/api/permissions/application/graph", {
          method: "GET",
        }),
      ).toHaveLength(2),
    );
  });
});
