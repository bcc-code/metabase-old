import {
  createMockAdminState,
  createMockPermissionsState,
  createMockState,
} from "__support__/state";
import {
  LOAD_DATA_PERMISSIONS,
  SAVE_DATA_PERMISSIONS,
} from "metabase/permissions";
import type { State } from "metabase/redux/store";
import {
  DataPermission,
  DataPermissionValue,
  type GroupTableAccessPolicyDraft,
  type GroupsPermissions,
} from "metabase-types/api";

import {
  getImpersonationsPayload,
  getSandboxesPayload,
  hasDataAccessChanges,
} from "./selectors";
import {
  type DataAccessState,
  EMPTY_DATA_ACCESS_STATE,
  dataAccessReducer,
  impersonationChanged,
  sandboxChanged,
} from "./state";

const GROUP_ID = 3;
const DATABASE_ID = 1;
const TABLE_ID = 10;
const ENTITY_ID = {
  databaseId: DATABASE_ID,
  schemaName: "PUBLIC",
  tableId: TABLE_ID,
};
const SANDBOX: GroupTableAccessPolicyDraft = {
  group_id: GROUP_ID,
  table_id: TABLE_ID,
  card_id: null,
  attribute_remappings: {
    region: ["dimension", ["field", 11, null]],
  },
};

function createState(
  dataPermissions: GroupsPermissions,
  dataAccess: DataAccessState,
): State {
  return Object.assign(
    createMockState({
      admin: createMockAdminState({
        permissions: createMockPermissionsState({ dataPermissions }),
      }),
    }),
    { plugins: { sandboxingPlugin: dataAccess } },
  );
}

describe("dataAccessReducer", () => {
  it("keeps one edited sandbox per group and table", () => {
    const state = [
      sandboxChanged({ entityId: ENTITY_ID, sandbox: SANDBOX }),
      sandboxChanged({
        entityId: ENTITY_ID,
        sandbox: { ...SANDBOX, card_id: 5 },
      }),
    ].reduce(dataAccessReducer, EMPTY_DATA_ACCESS_STATE);

    expect(state.sandboxes).toEqual([
      { entityId: ENTITY_ID, sandbox: { ...SANDBOX, card_id: 5 } },
    ]);
  });

  it("forgets edits when permissions are loaded (or reverted) and when they're saved", () => {
    const edited = dataAccessReducer(
      EMPTY_DATA_ACCESS_STATE,
      impersonationChanged({
        group_id: GROUP_ID,
        db_id: DATABASE_ID,
        attribute: "role",
      }),
    );

    expect(
      dataAccessReducer(edited, { type: LOAD_DATA_PERMISSIONS, payload: {} }),
    ).toEqual(EMPTY_DATA_ACCESS_STATE);
    expect(
      dataAccessReducer(edited, { type: SAVE_DATA_PERMISSIONS, payload: {} }),
    ).toEqual(EMPTY_DATA_ACCESS_STATE);
    expect(
      dataAccessReducer(edited, {
        type: SAVE_DATA_PERMISSIONS,
        payload: {},
        error: true,
      }),
    ).toBe(edited);
  });
});

describe("getSandboxesPayload", () => {
  const sandboxed: GroupsPermissions = {
    [GROUP_ID]: {
      [DATABASE_ID]: {
        [DataPermission.VIEW_DATA]: {
          PUBLIC: { [TABLE_ID]: DataPermissionValue.SANDBOXED },
        },
      },
    },
  };

  it("sends edited sandboxes of tables that are still sandboxed, and their groups", () => {
    const state = createState(sandboxed, {
      ...EMPTY_DATA_ACCESS_STATE,
      sandboxes: [{ entityId: ENTITY_ID, sandbox: SANDBOX }],
    });

    expect(getSandboxesPayload(state)).toEqual([
      { sandboxes: [SANDBOX] },
      [String(GROUP_ID)],
    ]);
    expect(hasDataAccessChanges(state)).toBe(true);
  });

  it("drops sandboxes of tables that were given another access level", () => {
    const state = createState(
      {
        [GROUP_ID]: {
          [DATABASE_ID]: {
            [DataPermission.VIEW_DATA]: DataPermissionValue.UNRESTRICTED,
          },
        },
      },
      {
        ...EMPTY_DATA_ACCESS_STATE,
        sandboxes: [{ entityId: ENTITY_ID, sandbox: SANDBOX }],
      },
    );

    expect(getSandboxesPayload(state)).toEqual([{}, []]);
  });

  it("sends nothing without edits", () => {
    const state = createState(sandboxed, EMPTY_DATA_ACCESS_STATE);

    expect(getSandboxesPayload(state)).toEqual([{}, []]);
    expect(hasDataAccessChanges(state)).toBe(false);
  });
});

describe("getImpersonationsPayload", () => {
  const impersonation = {
    group_id: GROUP_ID,
    db_id: DATABASE_ID,
    attribute: "role",
  };

  it("sends edited policies of databases that are still impersonated", () => {
    const state = createState(
      {
        [GROUP_ID]: {
          [DATABASE_ID]: {
            [DataPermission.VIEW_DATA]: DataPermissionValue.IMPERSONATED,
          },
        },
      },
      { ...EMPTY_DATA_ACCESS_STATE, impersonations: [impersonation] },
    );

    expect(getImpersonationsPayload(state)).toEqual([
      { impersonations: [impersonation] },
      [String(GROUP_ID)],
    ]);
  });

  it("drops policies of databases that were given another access level", () => {
    const state = createState(
      {
        [GROUP_ID]: {
          [DATABASE_ID]: {
            [DataPermission.VIEW_DATA]: DataPermissionValue.BLOCKED,
          },
        },
      },
      { ...EMPTY_DATA_ACCESS_STATE, impersonations: [impersonation] },
    );

    expect(getImpersonationsPayload(state)).toEqual([{}, []]);
  });
});
