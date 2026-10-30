import { mockSettings } from "__support__/settings";
import {
  PLUGIN_ADMIN_PERMISSIONS_DATABASE_ACTIONS,
  PLUGIN_ADMIN_PERMISSIONS_DATABASE_GROUP_ROUTES,
  PLUGIN_ADMIN_PERMISSIONS_DATABASE_POST_ACTIONS,
  PLUGIN_ADMIN_PERMISSIONS_TABLE_FIELDS_ACTIONS,
  PLUGIN_ADMIN_PERMISSIONS_TABLE_FIELDS_OPTIONS,
  PLUGIN_ADMIN_PERMISSIONS_TABLE_FIELDS_POST_ACTION,
  PLUGIN_ADMIN_PERMISSIONS_TABLE_ROUTES,
  PLUGIN_ADMIN_USER_FORM_FIELDS,
  PLUGIN_ADVANCED_PERMISSIONS,
  PLUGIN_DATA_PERMISSIONS,
  reinitialize,
} from "metabase/plugins";
import { DataPermissionValue } from "metabase-types/api";
import {
  createMockDatabase,
  createMockTokenFeatures,
} from "metabase-types/api/mocks";

import { UserAttributesField } from "./components/UserAttributesField";
import {
  BLOCKED_OPTION,
  IMPERSONATED_OPTION,
  SANDBOXED_OPTION,
} from "./permissions";

import { initializeDataAccessPlugin } from "./index";

interface SetupOpts {
  sandboxes: boolean;
  advancedPermissions: boolean;
}

function setup({ sandboxes, advancedPermissions }: SetupOpts) {
  mockSettings({
    "token-features": createMockTokenFeatures({
      sandboxes,
      advanced_permissions: advancedPermissions,
    }),
  });
  initializeDataAccessPlugin();
}

describe("initializeDataAccessPlugin", () => {
  afterEach(() => {
    reinitialize();
  });

  it("adds row and column security, blocking and impersonation to the permissions editor", () => {
    setup({ sandboxes: true, advancedPermissions: true });

    expect(PLUGIN_ADVANCED_PERMISSIONS.shouldShowViewDataColumn).toBe(true);
    expect(PLUGIN_ADVANCED_PERMISSIONS.defaultViewDataPermission).toBe(
      DataPermissionValue.BLOCKED,
    );
    expect(PLUGIN_ADMIN_PERMISSIONS_TABLE_FIELDS_OPTIONS).toEqual([
      SANDBOXED_OPTION,
    ]);
    expect(
      PLUGIN_ADMIN_PERMISSIONS_TABLE_FIELDS_ACTIONS.sandboxed,
    ).toHaveLength(1);
    expect(
      PLUGIN_ADMIN_PERMISSIONS_TABLE_FIELDS_POST_ACTION.sandboxed,
    ).not.toBeNull();
    expect(PLUGIN_ADMIN_PERMISSIONS_TABLE_ROUTES).toHaveLength(1);
    expect(
      PLUGIN_ADVANCED_PERMISSIONS.addDatabasePermissionOptions(
        [],
        createMockDatabase({ features: ["connection-impersonation"] }),
      ),
    ).toEqual([IMPERSONATED_OPTION, BLOCKED_OPTION]);
    expect(
      PLUGIN_ADVANCED_PERMISSIONS.addTablePermissionOptions([], ""),
    ).toEqual([BLOCKED_OPTION]);
    expect(PLUGIN_ADMIN_PERMISSIONS_DATABASE_ACTIONS.impersonated).toHaveLength(
      1,
    );
    expect(
      PLUGIN_ADMIN_PERMISSIONS_DATABASE_POST_ACTIONS.impersonated,
    ).not.toBeNull();
    expect(PLUGIN_ADMIN_PERMISSIONS_DATABASE_GROUP_ROUTES).toHaveLength(1);
    expect(
      PLUGIN_DATA_PERMISSIONS.permissionsPayloadExtraSelectors,
    ).toHaveLength(2);
    expect(PLUGIN_DATA_PERMISSIONS.hasChanges).toHaveLength(1);
    expect(PLUGIN_ADMIN_USER_FORM_FIELDS.FormLoginAttributes).toBe(
      UserAttributesField,
    );
  });

  it("only adds row and column security without advanced permissions", () => {
    setup({ sandboxes: true, advancedPermissions: false });

    expect(PLUGIN_ADMIN_PERMISSIONS_TABLE_FIELDS_OPTIONS).toEqual([
      SANDBOXED_OPTION,
    ]);
    expect(
      PLUGIN_ADVANCED_PERMISSIONS.addTablePermissionOptions([], ""),
    ).toEqual([]);
    expect(PLUGIN_ADMIN_PERMISSIONS_DATABASE_ACTIONS.impersonated).toEqual([]);
    expect(
      PLUGIN_DATA_PERMISSIONS.permissionsPayloadExtraSelectors,
    ).toHaveLength(1);
  });

  it("leaves the open-source permissions editor alone without either feature", () => {
    setup({ sandboxes: false, advancedPermissions: false });

    expect(PLUGIN_ADVANCED_PERMISSIONS.shouldShowViewDataColumn).toBe(false);
    expect(PLUGIN_ADMIN_PERMISSIONS_TABLE_FIELDS_OPTIONS).toEqual([]);
    expect(PLUGIN_DATA_PERMISSIONS.permissionsPayloadExtraSelectors).toEqual(
      [],
    );
    expect(PLUGIN_ADMIN_USER_FORM_FIELDS.FormLoginAttributes).not.toBe(
      UserAttributesField,
    );
  });
});
