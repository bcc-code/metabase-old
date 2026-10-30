import { t } from "ttag";

import {
  type PermissionAction,
  type PermissionOption,
  getSchemasPermission,
  isTableEntityId,
  updateEntityPermission,
} from "metabase/permissions";
import { navigate } from "metabase/router";
import {
  DataPermission,
  DataPermissionValue,
  type GroupId,
  type GroupsPermissions,
  type PermissionEntityId,
  type PermissionsDatabase,
} from "metabase-types/api";

import {
  type PermissionsView,
  getImpersonationUrl,
  getSandboxUrl,
} from "./urls";

export const SANDBOXED_OPTION: PermissionOption = {
  get label() {
    return t`Row and column security`;
  },
  value: DataPermissionValue.SANDBOXED,
  icon: "permissions_limited",
  iconColor: "feedback-warning",
};

export const IMPERSONATED_OPTION: PermissionOption = {
  get label() {
    return t`Impersonated`;
  },
  value: DataPermissionValue.IMPERSONATED,
  icon: "database",
  iconColor: "feedback-warning",
};

export const BLOCKED_OPTION: PermissionOption = {
  get label() {
    return t`Blocked`;
  },
  value: DataPermissionValue.BLOCKED,
  icon: "close",
  iconColor: "feedback-negative",
};

export function openSandboxEditor(
  entityId: PermissionEntityId | undefined,
  groupId: GroupId,
  view: PermissionsView,
) {
  if (entityId != null && isTableEntityId(entityId)) {
    navigate(getSandboxUrl(groupId, entityId, view));
  }
}

export function openImpersonationEditor(
  entityId: PermissionEntityId | undefined,
  groupId: GroupId,
  view: PermissionsView,
) {
  if (entityId != null) {
    navigate(getImpersonationUrl(groupId, entityId.databaseId, view));
  }
}

export const SANDBOX_ACTIONS: PermissionAction[] = [
  {
    get label() {
      return t`Edit row and column security`;
    },
    icon: "pencil",
    iconColor: "feedback-warning",
    onSelect: openSandboxEditor,
  },
];

export const IMPERSONATION_ACTIONS: PermissionAction[] = [
  {
    get label() {
      return t`Edit impersonated`;
    },
    icon: "pencil",
    iconColor: "feedback-warning",
    onSelect: openImpersonationEditor,
  },
];

/** View-data options of a database: impersonation where the driver supports it, and blocking. */
export function getDatabaseOptions(
  options: PermissionOption[],
  database: PermissionsDatabase,
): PermissionOption[] {
  const supportsImpersonation = (database.features ?? []).includes(
    "connection-impersonation",
  );
  const [first, ...rest] = options;
  return [
    ...(first ? [first] : []),
    ...(supportsImpersonation ? [IMPERSONATED_OPTION] : []),
    ...rest,
    BLOCKED_OPTION,
  ];
}

export function addBlockedOption(
  options: PermissionOption[],
): PermissionOption[] {
  return [...options, BLOCKED_OPTION];
}

/**
 * The view-data level a database switches to when an admin makes it granular:
 * impersonation applies to a whole database, so its tables become viewable.
 */
export function getDatabaseLimitedAccessPermission(
  value: string,
): DataPermissionValue | null {
  return value === DataPermissionValue.IMPERSONATED
    ? DataPermissionValue.UNRESTRICTED
    : null;
}

/** Tables of an impersonated database can't get a level of their own. */
export function isAccessPermissionDisabled(value: string): boolean {
  return value === DataPermissionValue.IMPERSONATED;
}

export function isRestrictivePermission(value: string): boolean {
  return value === DataPermissionValue.BLOCKED;
}

/** Sandboxing a table takes away native query access to its database, which sandboxes can't restrict. */
export function shouldRestrictNativeQueryPermissions(
  _permissions: GroupsPermissions,
  _groupId: number,
  _entityId: PermissionEntityId,
  permission: DataPermission,
  value: DataPermissionValue,
): boolean {
  return (
    permission === DataPermission.VIEW_DATA &&
    value === DataPermissionValue.SANDBOXED
  );
}

/**
 * Native queries read the whole database, so granting them gives the group
 * unrestricted view access to it (dropping its blocked and sandboxed tables),
 * unless the database is impersonated, which restricts native queries too.
 */
export function upgradeViewPermissionsIfNeeded(
  permissions: GroupsPermissions,
  groupId: number,
  entityId: PermissionEntityId,
  value: DataPermissionValue,
  database: PermissionsDatabase,
  permission: DataPermission,
): GroupsPermissions {
  if (
    permission !== DataPermission.CREATE_QUERIES ||
    value !== DataPermissionValue.QUERY_BUILDER_AND_NATIVE
  ) {
    return permissions;
  }
  const databaseEntityId = { databaseId: entityId.databaseId };
  const viewData = getSchemasPermission(
    permissions,
    groupId,
    databaseEntityId,
    DataPermission.VIEW_DATA,
  );
  if (
    viewData === DataPermissionValue.UNRESTRICTED ||
    viewData === DataPermissionValue.IMPERSONATED
  ) {
    return permissions;
  }
  return updateEntityPermission(
    permissions,
    groupId,
    databaseEntityId,
    DataPermissionValue.UNRESTRICTED,
    database,
    DataPermission.VIEW_DATA,
  );
}
