import { updateEntityPermission } from "metabase/permissions";
import {
  DataPermission,
  DataPermissionValue,
  type Group,
  type GroupsPermissions,
  type PermissionEntityId,
  type PermissionSubject,
  type SpecialGroupType,
} from "metabase-types/api";
import {
  createMockDatabase,
  createMockDataset,
  createMockGroup,
  createMockTable,
} from "metabase-types/api/mocks";

import {
  canDownloadResults,
  getDownloadWidgetMessageOverride,
  getFeatureLevelDataColumns,
  getFeatureLevelDataPermissions,
} from "./data-permissions";

const DATABASE_ID = 10;
const SCHEMA_NAME = "PUBLIC";
const BIRDS_TABLE_ID = 100;
const NESTS_TABLE_ID = 101;
const DEFAULT_GROUP_ID = 1;
const GROUP_ID = 5;

const database = createMockDatabase({
  id: DATABASE_ID,
  tables: [
    createMockTable({
      id: BIRDS_TABLE_ID,
      db_id: DATABASE_ID,
      schema: SCHEMA_NAME,
    }),
    createMockTable({
      id: NESTS_TABLE_ID,
      db_id: DATABASE_ID,
      schema: SCHEMA_NAME,
    }),
  ],
});

const defaultGroup: Group = {
  ...createMockGroup({
    id: DEFAULT_GROUP_ID,
    name: "All Users",
    magic_group_type: "all-internal-users",
  }),
  members: [],
};

const databaseEntityId: PermissionEntityId = { databaseId: DATABASE_ID };
const birdsTableEntityId: PermissionEntityId = {
  databaseId: DATABASE_ID,
  schemaName: SCHEMA_NAME,
  tableId: BIRDS_TABLE_ID,
};

const EMPTY_PERMISSIONS: GroupsPermissions = {};

function withPermission(
  permissions: GroupsPermissions,
  groupId: number,
  entityId: PermissionEntityId,
  permission: DataPermission,
  value: DataPermissionValue,
) {
  return updateEntityPermission(
    permissions,
    groupId,
    entityId,
    value,
    database,
    permission,
  );
}

interface SetupOpts {
  permissions?: GroupsPermissions;
  entityId?: PermissionEntityId;
  groupType?: SpecialGroupType;
  dataAccessPermissionValue?: DataPermissionValue;
  permissionSubject?: PermissionSubject;
}

function setup({
  permissions = EMPTY_PERMISSIONS,
  entityId = databaseEntityId,
  groupType = null,
  dataAccessPermissionValue = DataPermissionValue.UNRESTRICTED,
  permissionSubject = "schemas",
}: SetupOpts = {}) {
  const [download, dataModel, manageDatabase] = getFeatureLevelDataPermissions({
    entityId,
    groupId: GROUP_ID,
    groupType,
    permissions,
    dataAccessPermissionValue,
    defaultGroup,
    permissionSubject,
  });
  return { download, dataModel, manageDatabase };
}

const optionLabels = (options: { label: string }[]) =>
  options.map((option) => option.label);

describe("getFeatureLevelDataColumns", () => {
  it("shows the manage database column for whole databases only", () => {
    expect(getFeatureLevelDataColumns({ subject: "schemas" })).toEqual([
      { name: "Download results" },
      { name: "Manage table metadata" },
      { name: "Manage database" },
    ]);
    expect(getFeatureLevelDataColumns({ subject: "tables" })).toEqual([
      { name: "Download results" },
      { name: "Manage table metadata" },
    ]);
    expect(getFeatureLevelDataColumns({ subject: "fields" })).toEqual([
      { name: "Download results" },
      { name: "Manage table metadata" },
    ]);
  });
});

describe("getFeatureLevelDataPermissions", () => {
  it("returns one permission per column", () => {
    expect(
      getFeatureLevelDataPermissions({
        entityId: databaseEntityId,
        groupId: GROUP_ID,
        groupType: null,
        permissions: EMPTY_PERMISSIONS,
        dataAccessPermissionValue: DataPermissionValue.UNRESTRICTED,
        defaultGroup,
        permissionSubject: "tables",
      }),
    ).toHaveLength(getFeatureLevelDataColumns({ subject: "tables" }).length);
  });

  it("reads the group's database-level permissions from the graph", () => {
    let permissions = withPermission(
      EMPTY_PERMISSIONS,
      GROUP_ID,
      databaseEntityId,
      DataPermission.DOWNLOAD,
      DataPermissionValue.LIMITED,
    );
    permissions = withPermission(
      permissions,
      GROUP_ID,
      birdsTableEntityId,
      DataPermission.DATA_MODEL,
      DataPermissionValue.ALL,
    );
    permissions = withPermission(
      permissions,
      GROUP_ID,
      databaseEntityId,
      DataPermission.DETAILS,
      DataPermissionValue.YES,
    );

    const { download, dataModel, manageDatabase } = setup({ permissions });

    expect(download.value).toBe(DataPermissionValue.LIMITED);
    expect(dataModel.value).toBe(DataPermissionValue.CONTROLLED);
    expect(manageDatabase.value).toBe(DataPermissionValue.YES);
  });

  it("treats missing permissions as the most restrictive level", () => {
    const { download, dataModel, manageDatabase } = setup();

    expect(download.value).toBe(DataPermissionValue.NONE);
    expect(dataModel.value).toBe(DataPermissionValue.NONE);
    expect(manageDatabase.value).toBe(DataPermissionValue.NO);
  });

  it("offers granular download and data model access for databases and schemas", () => {
    const { download, dataModel } = setup();

    expect(optionLabels(download.options)).toEqual([
      "1 million rows",
      "10 thousand rows",
      "Granular",
      "No",
    ]);
    expect(optionLabels(dataModel.options)).toEqual(["Edit", "Granular", "No"]);
    expect(
      download.postActions?.[DataPermissionValue.CONTROLLED],
    ).toBeDefined();
    expect(
      dataModel.postActions?.[DataPermissionValue.CONTROLLED],
    ).toBeDefined();
  });

  it("doesn't offer granular access for a single table, nor database management", () => {
    const { download, dataModel, manageDatabase } = setup({
      entityId: birdsTableEntityId,
      permissionSubject: "fields",
    });

    expect(optionLabels(download.options)).toEqual([
      "1 million rows",
      "10 thousand rows",
      "No",
    ]);
    expect(optionLabels(dataModel.options)).toEqual(["Edit", "No"]);
    expect(download.postActions).toBeUndefined();
    expect(manageDatabase).toBeUndefined();
  });

  it("doesn't let the Administrators' permissions change", () => {
    const { download, dataModel, manageDatabase } = setup({
      groupType: "admin",
    });

    [download, dataModel, manageDatabase].forEach((permission) => {
      expect(permission.isDisabled).toBe(true);
      expect(permission.disabledTooltip).toBe(
        "Administrators always have the highest level of access to everything in Metabase.",
      );
    });
  });

  it("doesn't let blocked groups download results", () => {
    const { download, dataModel } = setup({
      dataAccessPermissionValue: DataPermissionValue.BLOCKED,
    });

    expect(download.isDisabled).toBe(true);
    expect(download.disabledTooltip).toBe(
      "Groups with Block data access can't download results",
    );
    expect(dataModel.isDisabled).toBe(false);
  });

  it("doesn't let the Data Analysts' table metadata permission change", () => {
    const { download, dataModel } = setup({ groupType: "analyst" });

    expect(download.isDisabled).toBe(false);
    expect(dataModel.isDisabled).toBe(true);
    expect(dataModel.disabledTooltip).toBe(
      "Data Analysts always have full access to edit table metadata.",
    );
  });

  it("doesn't let tenant groups manage table metadata or databases", () => {
    const { dataModel, manageDatabase } = setup({ groupType: "external" });

    expect(dataModel.isDisabled).toBe(true);
    expect(manageDatabase.isDisabled).toBe(true);
  });

  it("warns when the default group grants more", () => {
    const permissions = withPermission(
      EMPTY_PERMISSIONS,
      DEFAULT_GROUP_ID,
      databaseEntityId,
      DataPermission.DOWNLOAD,
      DataPermissionValue.FULL,
    );

    const { download } = setup({ permissions });

    expect(download.warning).toMatch(
      /The "All Users" group has a higher level of access than this/,
    );
    expect(download.confirmations?.(DataPermissionValue.NONE)).toEqual([
      expect.objectContaining({
        title: 'Revoke access even though "All Users" has greater access?',
      }),
    ]);
  });
});

describe("downloads", () => {
  it("lets people download unless their download permission is none", () => {
    expect(
      canDownloadResults(
        createMockDataset({
          data: { download_perms: DataPermissionValue.FULL },
        }),
      ),
    ).toBe(true);
    expect(
      canDownloadResults(
        createMockDataset({
          data: { download_perms: DataPermissionValue.LIMITED },
        }),
      ),
    ).toBe(true);
    expect(canDownloadResults(createMockDataset())).toBe(true);
    expect(
      canDownloadResults(
        createMockDataset({
          data: { download_perms: DataPermissionValue.NONE },
        }),
      ),
    ).toBe(false);
  });

  it("tells people with limited downloads about the smaller limit", () => {
    expect(
      getDownloadWidgetMessageOverride(
        createMockDataset({
          data: { download_perms: DataPermissionValue.LIMITED },
        }),
      ),
    ).toBe("The maximum download size is 10 thousand rows.");
    expect(
      getDownloadWidgetMessageOverride(
        createMockDataset({
          data: { download_perms: DataPermissionValue.FULL },
        }),
      ),
    ).toBeNull();
  });
});
