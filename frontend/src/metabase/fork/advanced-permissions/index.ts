import { t } from "ttag";

import { PLUGIN_APPLICATION_PERMISSIONS_SELECTORS } from "metabase/current-user";
import {
  PLUGIN_ADMIN_ALLOWED_PATH_GETTERS,
  PLUGIN_APPLICATION_PERMISSIONS,
  PLUGIN_FEATURE_LEVEL_PERMISSIONS,
  PLUGIN_GROUP_MANAGERS,
} from "metabase/plugins";
import MetabaseSettings from "metabase/utils/settings";

import { getApplicationPermissionsRoutes } from "./application-permissions/routes";
import {
  canDownloadResults,
  getDownloadWidgetMessageOverride,
  getFeatureLevelDataColumns,
  getFeatureLevelDataPermissions,
} from "./data-permissions";
import {
  UserTypeCell,
  UserTypeToggle,
  confirmDeleteMembershipAction,
  confirmUpdateMembershipAction,
  deleteGroup,
  getChangeMembershipConfirmation,
  getRemoveMembershipConfirmation,
} from "./group-managers";
import {
  canAccessDataModel,
  canAccessSettings,
  canManageSubscriptions,
  getAllowedAdminPaths,
} from "./selectors";

const APPLICATION_PERMISSIONS_TAB = {
  get name() {
    return t`Application`;
  },
  value: "application",
};

/**
 * Advanced permissions: download, table metadata and database management
 * permissions in the data permissions editor; the application permissions
 * (settings, monitoring, subscriptions) tab; access to the admin sections
 * those grant; and group managers. Does nothing unless the instance has the
 * `advanced-permissions` feature, which the backend enforces them with.
 */
export function initializeAdvancedPermissionsPlugin() {
  if (!MetabaseSettings.get("token-features")?.advanced_permissions) {
    return;
  }

  Object.assign(PLUGIN_FEATURE_LEVEL_PERMISSIONS, {
    getFeatureLevelDataPermissions,
    getDataColumns: getFeatureLevelDataColumns,
    canDownloadResults,
    getDownloadWidgetMessageOverride,
    dataModelQueryProps: { include_editable_data_model: true },
    databaseDetailsQueryProps: { exclude_uneditable_details: true },
  } satisfies Partial<typeof PLUGIN_FEATURE_LEVEL_PERMISSIONS>);

  PLUGIN_APPLICATION_PERMISSIONS.getRoutes = getApplicationPermissionsRoutes;
  PLUGIN_APPLICATION_PERMISSIONS.tabs = [APPLICATION_PERMISSIONS_TAB];

  Object.assign(PLUGIN_APPLICATION_PERMISSIONS_SELECTORS, {
    canAccessSettings,
    canAccessDataModel,
    canManageSubscriptions,
  } satisfies Partial<typeof PLUGIN_APPLICATION_PERMISSIONS_SELECTORS>);

  PLUGIN_ADMIN_ALLOWED_PATH_GETTERS.push(getAllowedAdminPaths);

  Object.assign(PLUGIN_GROUP_MANAGERS, {
    UserTypeToggle,
    UserTypeCell,
    getChangeMembershipConfirmation,
    getRemoveMembershipConfirmation,
    deleteGroup,
    confirmDeleteMembershipAction,
    confirmUpdateMembershipAction,
  } satisfies Partial<typeof PLUGIN_GROUP_MANAGERS>);
}
