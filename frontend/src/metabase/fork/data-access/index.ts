import {
  PLUGIN_ADMIN_PERMISSIONS_DATABASE_ACTIONS,
  PLUGIN_ADMIN_PERMISSIONS_DATABASE_GROUP_ROUTES,
  PLUGIN_ADMIN_PERMISSIONS_DATABASE_POST_ACTIONS,
  PLUGIN_ADMIN_PERMISSIONS_DATABASE_ROUTES,
  PLUGIN_ADMIN_PERMISSIONS_TABLE_FIELDS_ACTIONS,
  PLUGIN_ADMIN_PERMISSIONS_TABLE_FIELDS_OPTIONS,
  PLUGIN_ADMIN_PERMISSIONS_TABLE_FIELDS_POST_ACTION,
  PLUGIN_ADMIN_PERMISSIONS_TABLE_GROUP_ROUTES,
  PLUGIN_ADMIN_PERMISSIONS_TABLE_ROUTES,
  PLUGIN_ADMIN_USER_FORM_FIELDS,
  PLUGIN_ADVANCED_PERMISSIONS,
  PLUGIN_DATA_PERMISSIONS,
  PLUGIN_REDUCERS,
} from "metabase/plugins";
import MetabaseSettings from "metabase/utils/settings";
import { DataPermissionValue } from "metabase-types/api";

import { UserAttributesField } from "./components/UserAttributesField";
import {
  IMPERSONATION_ACTIONS,
  SANDBOXED_OPTION,
  SANDBOX_ACTIONS,
  addBlockedOption,
  getDatabaseLimitedAccessPermission,
  getDatabaseOptions,
  isAccessPermissionDisabled,
  isRestrictivePermission,
  openImpersonationEditor,
  openSandboxEditor,
  shouldRestrictNativeQueryPermissions,
  upgradeViewPermissionsIfNeeded,
} from "./permissions";
import {
  getImpersonationDatabaseViewRoutes,
  getImpersonationGroupViewRoutes,
  getSandboxDatabaseViewRoutes,
  getSandboxGroupViewRoutes,
} from "./routes";
import {
  DATA_ACCESS_STATE_KEY,
  getImpersonationsPayload,
  getSandboxesPayload,
  hasDataAccessChanges,
} from "./selectors";
import { dataAccessReducer } from "./state";

/**
 * Who sees which rows and columns: row and column security (sandboxes) when
 * the instance has the `sandboxes` feature, and blocked view-data access and
 * connection impersonation when it has `advanced-permissions`, in the data
 * permissions editor; and user attributes, which those policies use, in
 * Admin > People. The backend enforces all of them.
 */
export function initializeDataAccessPlugin() {
  const features = MetabaseSettings.get("token-features");
  const hasSandboxes = Boolean(features?.sandboxes);
  const hasAdvancedPermissions = Boolean(features?.advanced_permissions);
  if (!hasSandboxes && !hasAdvancedPermissions) {
    return;
  }

  PLUGIN_REDUCERS[DATA_ACCESS_STATE_KEY] = dataAccessReducer;
  PLUGIN_ADMIN_USER_FORM_FIELDS.FormLoginAttributes = UserAttributesField;
  PLUGIN_DATA_PERMISSIONS.hasChanges.push(hasDataAccessChanges);

  Object.assign(PLUGIN_ADVANCED_PERMISSIONS, {
    shouldShowViewDataColumn: true,
    // the permissions graph leaves out view-data entries at the least permissive level
    defaultViewDataPermission: DataPermissionValue.BLOCKED,
    isRestrictivePermission,
  } satisfies Partial<typeof PLUGIN_ADVANCED_PERMISSIONS>);

  if (hasSandboxes) {
    PLUGIN_ADMIN_PERMISSIONS_TABLE_FIELDS_OPTIONS.push(SANDBOXED_OPTION);
    PLUGIN_ADMIN_PERMISSIONS_TABLE_FIELDS_ACTIONS.sandboxed = SANDBOX_ACTIONS;
    PLUGIN_ADMIN_PERMISSIONS_TABLE_FIELDS_POST_ACTION.sandboxed = (
      entityId,
      groupId,
      view,
    ) => openSandboxEditor(entityId, groupId, view);
    PLUGIN_ADMIN_PERMISSIONS_TABLE_ROUTES.push(...getSandboxGroupViewRoutes());
    PLUGIN_ADMIN_PERMISSIONS_TABLE_GROUP_ROUTES.push(
      ...getSandboxDatabaseViewRoutes(),
    );
    PLUGIN_DATA_PERMISSIONS.permissionsPayloadExtraSelectors.push(
      getSandboxesPayload,
    );
    PLUGIN_DATA_PERMISSIONS.shouldRestrictNativeQueryPermissions =
      shouldRestrictNativeQueryPermissions;
    PLUGIN_DATA_PERMISSIONS.upgradeViewPermissionsIfNeeded =
      upgradeViewPermissionsIfNeeded;
  }

  if (hasAdvancedPermissions) {
    Object.assign(PLUGIN_ADVANCED_PERMISSIONS, {
      addDatabasePermissionOptions: getDatabaseOptions,
      addSchemaPermissionOptions: addBlockedOption,
      addTablePermissionOptions: addBlockedOption,
      getDatabaseLimitedAccessPermission,
      isAccessPermissionDisabled,
    } satisfies Partial<typeof PLUGIN_ADVANCED_PERMISSIONS>);
    PLUGIN_ADMIN_PERMISSIONS_DATABASE_ACTIONS.impersonated =
      IMPERSONATION_ACTIONS;
    PLUGIN_ADMIN_PERMISSIONS_DATABASE_POST_ACTIONS.impersonated = (
      entityId,
      groupId,
      view,
    ) => openImpersonationEditor(entityId, groupId, view);
    PLUGIN_ADMIN_PERMISSIONS_DATABASE_GROUP_ROUTES.push(
      ...getImpersonationGroupViewRoutes(),
    );
    PLUGIN_ADMIN_PERMISSIONS_DATABASE_ROUTES.push(
      ...getImpersonationDatabaseViewRoutes(),
    );
    PLUGIN_DATA_PERMISSIONS.permissionsPayloadExtraSelectors.push(
      getImpersonationsPayload,
    );
  }
}
