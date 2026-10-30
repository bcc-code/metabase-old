import type {
  ApplicationPermissionsGraph,
  GroupInfo,
} from "metabase-types/api";
import { DataPermissionValue } from "metabase-types/api";

import {
  getApplicationPermissionKey,
  getApplicationPermissionValue,
  getApplicationPermissionsEntities,
  toApplicationPermissionValue,
  updateApplicationPermissionsEdits,
} from "./utils";

const ADMIN_GROUP: GroupInfo = {
  id: 2,
  name: "Administrators",
  magic_group_type: "admin",
};
const ALL_USERS_GROUP: GroupInfo = {
  id: 1,
  name: "All Users",
  magic_group_type: "all-internal-users",
};
const BIRDERS_GROUP: GroupInfo = {
  id: 3,
  name: "Birders",
  magic_group_type: null,
};
const ARCHIVED_GROUP: GroupInfo = {
  id: 4,
  name: "Not in the graph",
  magic_group_type: null,
};

const GRAPH: ApplicationPermissionsGraph = {
  revision: 7,
  groups: {
    1: { setting: "no", monitoring: "no", subscription: "yes" },
    2: { setting: "yes", monitoring: "yes", subscription: "yes" },
    3: { setting: "no", monitoring: "yes", subscription: "no" },
  },
};

describe("updateApplicationPermissionsEdits", () => {
  it("records changes per group and permission", () => {
    const edits = updateApplicationPermissionsEdits(
      {},
      GRAPH,
      3,
      "setting",
      "yes",
    );
    expect(edits).toEqual({ 3: { setting: "yes" } });

    expect(
      updateApplicationPermissionsEdits(edits, GRAPH, 3, "monitoring", "no"),
    ).toEqual({ 3: { setting: "yes", monitoring: "no" } });
  });

  it("drops edits that restore the saved value", () => {
    const edits = updateApplicationPermissionsEdits(
      { 3: { setting: "yes", monitoring: "no" } },
      GRAPH,
      3,
      "monitoring",
      "yes",
    );
    expect(edits).toEqual({ 3: { setting: "yes" } });
    expect(
      updateApplicationPermissionsEdits(edits, GRAPH, 3, "setting", "no"),
    ).toEqual({});
  });
});

describe("getApplicationPermissionValue", () => {
  it("prefers unsaved edits over the saved graph", () => {
    expect(getApplicationPermissionValue(GRAPH, {}, 3, "monitoring")).toBe(
      "yes",
    );
    expect(
      getApplicationPermissionValue(
        GRAPH,
        { 3: { monitoring: "no" } },
        3,
        "monitoring",
      ),
    ).toBe("no");
  });
});

describe("getApplicationPermissionKey", () => {
  it("finds the permission each editor cell holds", () => {
    const entities = getApplicationPermissionsEntities(GRAPH, {}, [
      BIRDERS_GROUP,
    ]);
    expect(
      entities[0].permissions?.map((permission) =>
        getApplicationPermissionKey(permission.type),
      ),
    ).toEqual(["setting", "monitoring", "subscription"]);
  });
});

describe("toApplicationPermissionValue", () => {
  it("maps editor values to graph values", () => {
    expect(toApplicationPermissionValue(DataPermissionValue.YES)).toBe("yes");
    expect(toApplicationPermissionValue(DataPermissionValue.NO)).toBe("no");
  });
});

describe("getApplicationPermissionsEntities", () => {
  const entities = getApplicationPermissionsEntities(GRAPH, {}, [
    BIRDERS_GROUP,
    ARCHIVED_GROUP,
    ALL_USERS_GROUP,
    ADMIN_GROUP,
  ]);

  it("lists the groups in the graph, special groups first", () => {
    expect(entities.map((entity) => entity.name)).toEqual([
      "Administrators",
      "All Users",
      "Birders",
    ]);
  });

  it("shows settings, monitoring and subscriptions access for each group", () => {
    const birders = entities[2];
    expect(birders.permissions?.map((permission) => permission.value)).toEqual([
      DataPermissionValue.NO,
      DataPermissionValue.YES,
      DataPermissionValue.NO,
    ]);
    expect(
      birders.permissions?.every((permission) => !permission.isDisabled),
    ).toBe(true);
  });

  it("doesn't let the Administrators' permissions change", () => {
    const administrators = entities[0];
    expect(
      administrators.permissions?.every((permission) => permission.isDisabled),
    ).toBe(true);
  });
});
