import { mockSettings } from "__support__/settings";
import { PLUGIN_APPLICATION_PERMISSIONS_SELECTORS } from "metabase/current-user";
import {
  PLUGIN_ADMIN_ALLOWED_PATH_GETTERS,
  PLUGIN_APPLICATION_PERMISSIONS,
  PLUGIN_FEATURE_LEVEL_PERMISSIONS,
  PLUGIN_GROUP_MANAGERS,
  reinitialize,
} from "metabase/plugins";
import { createMockTokenFeatures } from "metabase-types/api/mocks";

import { canAccessSettings } from "./selectors";

import { initializeAdvancedPermissionsPlugin } from "./index";

function setup({ hasFeature }: { hasFeature: boolean }) {
  mockSettings({
    "token-features": createMockTokenFeatures({
      advanced_permissions: hasFeature,
    }),
  });
  initializeAdvancedPermissionsPlugin();
}

describe("initializeAdvancedPermissionsPlugin", () => {
  afterEach(() => {
    reinitialize();
  });

  it("fills the plugin slots when the instance has advanced permissions", () => {
    setup({ hasFeature: true });

    expect(PLUGIN_APPLICATION_PERMISSIONS.tabs).toEqual([
      expect.objectContaining({ name: "Application", value: "application" }),
    ]);
    expect(PLUGIN_FEATURE_LEVEL_PERMISSIONS.dataModelQueryProps).toEqual({
      include_editable_data_model: true,
    });
    expect(PLUGIN_APPLICATION_PERMISSIONS_SELECTORS.canAccessSettings).toBe(
      canAccessSettings,
    );
    expect(PLUGIN_ADMIN_ALLOWED_PATH_GETTERS).toHaveLength(1);
    expect(PLUGIN_GROUP_MANAGERS.UserTypeCell).not.toBeNull();
  });

  it("leaves the open-source behavior alone without the feature", () => {
    setup({ hasFeature: false });

    expect(PLUGIN_APPLICATION_PERMISSIONS.tabs).toEqual([]);
    expect(PLUGIN_FEATURE_LEVEL_PERMISSIONS.dataModelQueryProps).toEqual({});
    expect(PLUGIN_ADMIN_ALLOWED_PATH_GETTERS).toHaveLength(0);
    expect(PLUGIN_GROUP_MANAGERS.UserTypeCell).toBeNull();
  });
});
