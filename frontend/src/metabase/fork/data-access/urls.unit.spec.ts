import {
  getImpersonationParentUrl,
  getImpersonationUrl,
  getSandboxParentUrl,
  getSandboxUrl,
} from "./urls";

const TABLE = { databaseId: 1, schemaName: "PUBLIC", tableId: 10 };

describe("sandbox editor URLs", () => {
  it("opens over a group's tables of a schema", () => {
    expect(getSandboxUrl(3, TABLE, "group")).toBe(
      "/admin/permissions/data/group/3/database/1/schema/PUBLIC/segmented/table/10",
    );
    expect(getSandboxParentUrl(3, TABLE, "group")).toBe(
      "/admin/permissions/data/group/3/database/1/schema/PUBLIC",
    );
  });

  it("opens over a group's tables of a database without schemas", () => {
    expect(getSandboxUrl(3, { ...TABLE, schemaName: undefined }, "group")).toBe(
      "/admin/permissions/data/group/3/database/1/segmented/table/10",
    );
  });

  it("opens over a table's groups", () => {
    expect(getSandboxUrl(3, TABLE, "database")).toBe(
      "/admin/permissions/data/database/1/schema/PUBLIC/table/10/segmented/group/3",
    );
    expect(getSandboxParentUrl(3, TABLE, "database")).toBe(
      "/admin/permissions/data/database/1/schema/PUBLIC/table/10",
    );
  });
});

describe("impersonation editor URLs", () => {
  it("opens over a group's databases", () => {
    expect(getImpersonationUrl(3, 1, "group")).toBe(
      "/admin/permissions/data/group/3/impersonated/database/1",
    );
    expect(getImpersonationParentUrl(3, 1, "group")).toBe(
      "/admin/permissions/data/group/3",
    );
  });

  it("opens over a database's groups", () => {
    expect(getImpersonationUrl(3, 1, "database")).toBe(
      "/admin/permissions/data/database/1/impersonated/group/3",
    );
  });
});
