import { createMockState } from "__support__/state";
import { createMockUser } from "metabase-types/api/mocks";

import {
  canAccessDataModel,
  canAccessSettings,
  canManageSubscriptions,
  getAllowedAdminPaths,
} from "./selectors";

describe("getAllowedAdminPaths", () => {
  it("opens no admin section to someone without advanced permissions", () => {
    expect(
      getAllowedAdminPaths(
        createMockUser({
          permissions: {
            can_access_setting: false,
            can_access_data_model: false,
            can_access_db_details: false,
            is_group_manager: false,
          },
        }),
      ),
    ).toEqual([]);
    expect(getAllowedAdminPaths(null)).toEqual([]);
  });

  it("opens the section each permission grants", () => {
    expect(
      getAllowedAdminPaths(
        createMockUser({ permissions: { can_access_setting: true } }),
      ),
    ).toEqual(["settings"]);
    expect(
      getAllowedAdminPaths(
        createMockUser({ permissions: { can_access_data_model: true } }),
      ),
    ).toEqual(["data-model"]);
    expect(
      getAllowedAdminPaths(
        createMockUser({ permissions: { can_access_db_details: true } }),
      ),
    ).toEqual(["databases"]);
    expect(
      getAllowedAdminPaths(
        createMockUser({ permissions: { is_group_manager: true } }),
      ),
    ).toEqual(["people"]);
  });

  it("doesn't open the monitoring tools or subscriptions as admin sections", () => {
    expect(
      getAllowedAdminPaths(
        createMockUser({
          permissions: {
            can_access_monitoring: true,
            can_access_subscription: true,
          },
        }),
      ),
    ).toEqual([]);
  });
});

describe("application permission selectors", () => {
  it("read the current user's application permissions", () => {
    const state = createMockState({
      currentUser: createMockUser({
        permissions: {
          can_access_setting: true,
          can_access_subscription: false,
          can_access_data_model: true,
        },
      }),
    });

    expect(canAccessSettings(state)).toBe(true);
    expect(canManageSubscriptions(state)).toBe(false);
    expect(canAccessDataModel(state)).toBe(true);
  });

  it("deny what the current user's permissions don't mention", () => {
    const state = createMockState({
      currentUser: createMockUser({ permissions: {} }),
    });

    expect(canAccessSettings(state)).toBe(false);
    expect(canManageSubscriptions(state)).toBe(false);
    expect(canAccessDataModel(state)).toBe(false);
  });

  it("let admins access the data model", () => {
    const state = createMockState({
      currentUser: createMockUser({ is_superuser: true, permissions: {} }),
    });

    expect(canAccessDataModel(state)).toBe(true);
  });
});
