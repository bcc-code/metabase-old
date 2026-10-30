import {
  type PermissionOption,
  getSchemasPermission,
} from "metabase/permissions";
import {
  DataPermission,
  DataPermissionValue,
  type GroupsPermissions,
  type SchemasPermissions,
} from "metabase-types/api";
import { createMockDatabase } from "metabase-types/api/mocks";

import {
  BLOCKED_OPTION,
  IMPERSONATED_OPTION,
  addBlockedOption,
  getDatabaseLimitedAccessPermission,
  getDatabaseOptions,
  shouldRestrictNativeQueryPermissions,
  upgradeViewPermissionsIfNeeded,
} from "./permissions";

const CAN_VIEW: PermissionOption = {
  label: "Can view",
  value: DataPermissionValue.UNRESTRICTED,
  icon: "eye",
  iconColor: "feedback-positive",
};
const GRANULAR: PermissionOption = {
  label: "Granular",
  value: DataPermissionValue.CONTROLLED,
  icon: "permissions_limited",
  iconColor: "feedback-warning",
};

describe("getDatabaseOptions", () => {
  it("offers impersonation for databases whose driver supports it, and blocking", () => {
    const database = createMockDatabase({
      features: ["connection-impersonation"],
    });

    expect(getDatabaseOptions([CAN_VIEW, GRANULAR], database)).toEqual([
      CAN_VIEW,
      IMPERSONATED_OPTION,
      GRANULAR,
      BLOCKED_OPTION,
    ]);
  });

  it("doesn't offer impersonation for other databases", () => {
    const database = createMockDatabase({ features: [] });

    expect(getDatabaseOptions([CAN_VIEW, GRANULAR], database)).toEqual([
      CAN_VIEW,
      GRANULAR,
      BLOCKED_OPTION,
    ]);
  });
});

describe("addBlockedOption", () => {
  it("adds blocking last", () => {
    expect(addBlockedOption([CAN_VIEW])).toEqual([CAN_VIEW, BLOCKED_OPTION]);
  });
});

describe("getDatabaseLimitedAccessPermission", () => {
  it("makes the tables of an impersonated database viewable when it becomes granular", () => {
    expect(
      getDatabaseLimitedAccessPermission(DataPermissionValue.IMPERSONATED),
    ).toBe(DataPermissionValue.UNRESTRICTED);
    expect(
      getDatabaseLimitedAccessPermission(DataPermissionValue.BLOCKED),
    ).toBeNull();
  });
});

describe("shouldRestrictNativeQueryPermissions", () => {
  it("restricts native queries when a table gets row and column security", () => {
    const entityId = { databaseId: 1, schemaName: "PUBLIC", tableId: 2 };

    expect(
      shouldRestrictNativeQueryPermissions(
        {},
        1,
        entityId,
        DataPermission.VIEW_DATA,
        DataPermissionValue.SANDBOXED,
      ),
    ).toBe(true);
    expect(
      shouldRestrictNativeQueryPermissions(
        {},
        1,
        entityId,
        DataPermission.VIEW_DATA,
        DataPermissionValue.UNRESTRICTED,
      ),
    ).toBe(false);
  });
});

describe("upgradeViewPermissionsIfNeeded", () => {
  const database = createMockDatabase({ id: 1 });
  const withViewData = (value: SchemasPermissions): GroupsPermissions => ({
    2: {
      1: {
        [DataPermission.VIEW_DATA]: value,
        [DataPermission.CREATE_QUERIES]: DataPermissionValue.QUERY_BUILDER,
      },
    },
  });
  const upgrade = (
    permissions: GroupsPermissions,
    value: DataPermissionValue,
  ) =>
    upgradeViewPermissionsIfNeeded(
      permissions,
      2,
      { databaseId: 1 },
      value,
      database,
      DataPermission.CREATE_QUERIES,
    );
  const viewData = (permissions: GroupsPermissions) =>
    getSchemasPermission(
      permissions,
      2,
      { databaseId: 1 },
      DataPermission.VIEW_DATA,
    );

  it("gives unrestricted view access to a group granted native queries", () => {
    const upgraded = upgrade(
      withViewData(DataPermissionValue.BLOCKED),
      DataPermissionValue.QUERY_BUILDER_AND_NATIVE,
    );

    expect(viewData(upgraded)).toBe(DataPermissionValue.UNRESTRICTED);
  });

  it("keeps an impersonated database impersonated", () => {
    const permissions = withViewData(DataPermissionValue.IMPERSONATED);

    expect(
      upgrade(permissions, DataPermissionValue.QUERY_BUILDER_AND_NATIVE),
    ).toBe(permissions);
  });

  it("leaves other changes alone", () => {
    const permissions = withViewData(DataPermissionValue.BLOCKED);

    expect(upgrade(permissions, DataPermissionValue.QUERY_BUILDER)).toBe(
      permissions,
    );
  });
});
