import userEvent from "@testing-library/user-event";
import fetchMock from "fetch-mock";

import {
  setupDatabaseMetadataEndpoint,
  setupGroupTableAccessPolicyEndpoint,
  setupTableQueryMetadataEndpoint,
  setupUserAttributesEndpoint,
  setupValidateGroupTableAccessPolicyEndpoint,
} from "__support__/server-mocks";
import {
  createMockAdminState,
  createMockPermissionsState,
} from "__support__/state";
import { renderWithProviders, screen, waitFor, within } from "__support__/ui";
import { getFieldsPermission } from "metabase/permissions";
import { PLUGIN_REDUCERS, reinitialize } from "metabase/plugins";
import {
  DataPermission,
  DataPermissionValue,
  type GroupTableAccessPolicy,
  type GroupsPermissions,
} from "metabase-types/api";
import {
  createMockDatabase,
  createMockField,
  createMockTable,
} from "metabase-types/api/mocks";

import { DATA_ACCESS_STATE_KEY, getDataAccessState } from "../../selectors";
import { dataAccessReducer } from "../../state";

import { SandboxModal } from "./SandboxModal";

const GROUP_ID = 3;
const DATABASE_ID = 1;
const TABLE_ID = 10;
const FIELD_ID = 11;
const ENTITY_ID = {
  databaseId: DATABASE_ID,
  schemaName: "PUBLIC",
  tableId: TABLE_ID,
};
const PERMISSIONS: GroupsPermissions = {
  [GROUP_ID]: {
    [DATABASE_ID]: {
      [DataPermission.VIEW_DATA]: DataPermissionValue.UNRESTRICTED,
      [DataPermission.CREATE_QUERIES]: DataPermissionValue.QUERY_BUILDER,
    },
  },
};

interface SetupOpts {
  policy?: GroupTableAccessPolicy | null;
  validationError?: string;
}

function setup({ policy = null, validationError }: SetupOpts = {}) {
  const table = createMockTable({
    id: TABLE_ID,
    db_id: DATABASE_ID,
    schema: "PUBLIC",
    display_name: "Venues",
    fields: [
      createMockField({
        id: FIELD_ID,
        table_id: TABLE_ID,
        display_name: "Category ID",
      }),
    ],
  });
  setupTableQueryMetadataEndpoint(table);
  setupDatabaseMetadataEndpoint(
    createMockDatabase({ id: DATABASE_ID, tables: [table] }),
  );
  setupGroupTableAccessPolicyEndpoint(GROUP_ID, TABLE_ID, policy);
  setupUserAttributesEndpoint(["cat", "region"]);
  setupValidateGroupTableAccessPolicyEndpoint(validationError);
  PLUGIN_REDUCERS[DATA_ACCESS_STATE_KEY] = dataAccessReducer;

  const onClose = jest.fn<void, []>();
  const { store } = renderWithProviders(
    <SandboxModal
      groupId={GROUP_ID}
      entityId={ENTITY_ID}
      view="group"
      onClose={onClose}
    />,
    {
      storeInitialState: {
        admin: createMockAdminState({
          permissions: createMockPermissionsState({
            dataPermissions: PERMISSIONS,
            originalDataPermissions: PERMISSIONS,
          }),
        }),
      },
    },
  );

  return { onClose, store };
}

async function fillFilter() {
  await userEvent.click(
    await screen.findByRole("button", { name: /Add a filter/ }),
  );
  await userEvent.type(screen.getByLabelText("User attribute"), "cat");
  await userEvent.click(screen.getByLabelText("Column of the table"));
  await userEvent.click(
    within(await screen.findByRole("listbox")).getByRole("option", {
      name: "Category ID",
    }),
  );
}

describe("SandboxModal", () => {
  afterEach(() => {
    reinitialize();
  });

  it("records a policy the server validated and marks the table as sandboxed", async () => {
    const { onClose, store } = setup();

    await fillFilter();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const expectedSandbox = {
      group_id: GROUP_ID,
      table_id: TABLE_ID,
      card_id: null,
      attribute_remappings: {
        cat: ["dimension", ["field", FIELD_ID, null]],
      },
    };
    const validateCall = fetchMock.callHistory.lastCall(
      "path:/api/mt/gtap/validate",
    );
    const body: unknown = JSON.parse(String(validateCall?.options.body));
    expect(body).toEqual(expectedSandbox);
    expect(getDataAccessState(store.getState()).sandboxes).toEqual([
      { entityId: ENTITY_ID, sandbox: expectedSandbox },
    ]);
    await waitFor(() =>
      expect(
        getFieldsPermission(
          store.getState().admin.permissions.dataPermissions,
          GROUP_ID,
          ENTITY_ID,
          DataPermission.VIEW_DATA,
        ),
      ).toBe(DataPermissionValue.SANDBOXED),
    );
  });

  it("keeps the editor open with the server's reason when it refuses the policy", async () => {
    const { onClose, store } = setup({
      validationError:
        'User attribute "cat" is remapped onto a column that isn\'t in the table or question.',
    });

    await fillFilter();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "isn't in the table or question",
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(getDataAccessState(store.getState()).sandboxes).toEqual([]);
  });

  it("starts from the saved policy", async () => {
    setup({
      policy: {
        id: 1,
        group_id: GROUP_ID,
        table_id: TABLE_ID,
        card_id: null,
        attribute_remappings: {
          region: ["dimension", ["field", FIELD_ID, null]],
        },
        permission_id: null,
      },
    });

    expect(await screen.findByLabelText("User attribute")).toHaveValue(
      "region",
    );
    expect(screen.getByLabelText("Column of the table")).toHaveValue(
      "Category ID",
    );
  });
});
