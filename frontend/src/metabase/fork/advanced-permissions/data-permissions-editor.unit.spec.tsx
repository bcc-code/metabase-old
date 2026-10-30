import userEvent from "@testing-library/user-event";
import fetchMock from "fetch-mock";

import {
  setupDatabasesEndpoints,
  setupGroupsEndpoint,
  setupPermissionsGraphEndpoints,
} from "__support__/server-mocks";
import { mockSettings } from "__support__/settings";
import { createMockState } from "__support__/state";
import {
  renderWithProviders,
  screen,
  waitForLoaderToBeRemoved,
  within,
} from "__support__/ui";
import { DataPermissionsPage } from "metabase/admin/permissions/pages/DataPermissionsPage/DataPermissionsPage";
import { GroupsPermissionsPage } from "metabase/admin/permissions/pages/GroupDataPermissionsPage/GroupsPermissionsPage";
import { reinitialize } from "metabase/plugins";
import { Route } from "metabase/router";
import {
  createMockGroup,
  createMockTokenFeatures,
} from "metabase-types/api/mocks";
import { createSampleDatabase } from "metabase-types/api/mocks/presets";

import { initializeAdvancedPermissionsPlugin } from "./index";

const DATABASE = createSampleDatabase();

const GROUPS = [
  createMockGroup({ id: 2, name: "Administrators", magic_group_type: "admin" }),
  createMockGroup({
    id: 1,
    name: "All internal users",
    magic_group_type: "all-internal-users",
  }),
  createMockGroup({ id: 3, name: "Birders", magic_group_type: null }),
];

const DOWNLOAD_COLUMN_INDEX = 1;

async function setup() {
  const settings = mockSettings({
    "token-features": createMockTokenFeatures({ advanced_permissions: true }),
  });
  initializeAdvancedPermissionsPlugin();

  setupDatabasesEndpoints([DATABASE]);
  setupPermissionsGraphEndpoints(GROUPS, [DATABASE]);
  setupGroupsEndpoint(GROUPS);
  fetchMock.get(`path:/api/database/${DATABASE.id}/metadata`, DATABASE);

  renderWithProviders(
    <Route path="/admin/permissions/data" element={<DataPermissionsPage />}>
      <Route path="group/:groupId" element={<GroupsPermissionsPage />} />
    </Route>,
    {
      storeInitialState: createMockState({ settings }),
      withRouter: true,
      initialRoute: "/admin/permissions/data/group/3",
    },
  );

  await waitForLoaderToBeRemoved();
}

describe("data permissions editor with advanced permissions", () => {
  afterEach(() => {
    reinitialize();
  });

  it("shows download, table metadata and database management columns", async () => {
    await setup();

    expect(await screen.findByText("Download results")).toBeInTheDocument();
    expect(screen.getByText("Manage table metadata")).toBeInTheDocument();
    expect(screen.getByText("Manage database")).toBeInTheDocument();

    const databaseRow = await screen.findByRole("row", {
      name: new RegExp(`^${DATABASE.name}`),
    });
    expect(
      within(databaseRow)
        .getAllByTestId("permissions-select")
        .map((select) => select.textContent),
    ).toEqual(["Query builder and native", "1 million rows", "No", "No"]);
  });

  it("limits a group's downloads after warning that the default group grants more", async () => {
    await setup();

    const databaseRow = await screen.findByRole("row", {
      name: new RegExp(`^${DATABASE.name}`),
    });
    await userEvent.click(
      within(databaseRow).getAllByTestId("permissions-select")[
        DOWNLOAD_COLUMN_INDEX
      ],
    );
    await userEvent.click(
      within(await screen.findByRole("listbox")).getByText("10 thousand rows"),
    );
    // "All internal users" can download more, so the editor asks to confirm
    await userEvent.click(
      await screen.findByRole("button", { name: "Revoke access" }),
    );

    expect(
      await screen.findByText("You've made changes to permissions."),
    ).toBeInTheDocument();
    expect(
      within(databaseRow).getAllByTestId("permissions-select")[
        DOWNLOAD_COLUMN_INDEX
      ],
    ).toHaveTextContent("10 thousand rows");
  });
});
