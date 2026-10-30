import { t } from "ttag";

import {
  getGroupNameLocalized,
  getGroupSortOrder,
  isAdminGroup,
} from "metabase/common/utils/groups";
import {
  Messages,
  type PermissionEditorEntity,
  type PermissionOption,
  type PermissionSectionConfig,
} from "metabase/permissions";
import { PLUGIN_TENANTS } from "metabase/plugins";
import {
  type ApplicationPermissionKey,
  type ApplicationPermissionValue,
  type ApplicationPermissions,
  type ApplicationPermissionsGraph,
  DataPermission,
  DataPermissionType,
  DataPermissionValue,
  type GroupId,
  type GroupInfo,
} from "metabase-types/api";

/** The application permissions, in the order of the editor's columns. */
export const APPLICATION_PERMISSION_KEYS: readonly ApplicationPermissionKey[] =
  ["setting", "monitoring", "subscription"];

const PERMISSION_TYPES: Record<ApplicationPermissionKey, DataPermissionType> = {
  setting: DataPermissionType.APPLICATION_SETTING,
  monitoring: DataPermissionType.APPLICATION_MONITORING,
  subscription: DataPermissionType.APPLICATION_SUBSCRIPTION,
};

/** The application permission an editor cell of `type` holds, if any. */
export const getApplicationPermissionKey = (
  type: DataPermissionType,
): ApplicationPermissionKey | undefined =>
  APPLICATION_PERMISSION_KEYS.find((key) => PERMISSION_TYPES[key] === type);

/** Unsaved changes: group ID -> the permissions changed for that group. */
export type ApplicationPermissionsEdits = Record<
  GroupId,
  Partial<ApplicationPermissions>
>;

export function getApplicationPermissionsColumns(): { name: string }[] {
  return [
    { name: t`Group name` },
    { name: t`Settings access` },
    { name: t`Monitoring access` },
    { name: t`Subscriptions and alerts` },
  ];
}

export function getApplicationPermissionValue(
  graph: ApplicationPermissionsGraph,
  edits: ApplicationPermissionsEdits,
  groupId: GroupId,
  key: ApplicationPermissionKey,
): ApplicationPermissionValue {
  const groupEdits: Partial<ApplicationPermissions> | undefined =
    edits[groupId];
  const savedPermissions: ApplicationPermissions | undefined =
    graph.groups[groupId];
  return groupEdits?.[key] ?? savedPermissions?.[key] ?? "no";
}

/**
 * Records that `groupId` should get `value` for `key`. An edit back to the
 * saved value is dropped, so the edits only ever hold real changes.
 */
export function updateApplicationPermissionsEdits(
  edits: ApplicationPermissionsEdits,
  graph: ApplicationPermissionsGraph,
  groupId: GroupId,
  key: ApplicationPermissionKey,
  value: ApplicationPermissionValue,
): ApplicationPermissionsEdits {
  const savedPermissions: ApplicationPermissions | undefined =
    graph.groups[groupId];
  const groupEdits: Partial<ApplicationPermissions> = { ...edits[groupId] };
  if (value === savedPermissions?.[key]) {
    delete groupEdits[key];
  } else {
    groupEdits[key] = value;
  }

  const nextEdits = { ...edits };
  if (Object.keys(groupEdits).length > 0) {
    nextEdits[groupId] = groupEdits;
  } else {
    delete nextEdits[groupId];
  }
  return nextEdits;
}

const YES_OPTION: PermissionOption = {
  get label() {
    return t`Yes`;
  },
  value: DataPermissionValue.YES,
  icon: "check",
  iconColor: "feedback-positive",
};

const NO_OPTION: PermissionOption = {
  get label() {
    return t`No`;
  },
  value: DataPermissionValue.NO,
  icon: "close",
  iconColor: "feedback-negative",
};

export const toApplicationPermissionValue = (
  value: DataPermissionValue,
): ApplicationPermissionValue =>
  value === DataPermissionValue.YES ? "yes" : "no";

function getDisabledTooltip(
  group: GroupInfo,
  key: ApplicationPermissionKey,
): string | null {
  if (isAdminGroup(group)) {
    return Messages.UNABLE_TO_CHANGE_ADMIN_PERMISSIONS;
  }
  const isTenantGroup =
    PLUGIN_TENANTS.isTenantGroup(group) ||
    PLUGIN_TENANTS.isExternalUsersGroup(group);
  if (isTenantGroup && key === "setting") {
    return Messages.EXTERNAL_USERS_NO_ACCESS_SETTINGS;
  }
  if (isTenantGroup && key === "monitoring") {
    return Messages.EXTERNAL_USERS_NO_ACCESS_MONITORING;
  }
  return null;
}

function getGroupPermissions(
  graph: ApplicationPermissionsGraph,
  edits: ApplicationPermissionsEdits,
  group: GroupInfo,
): PermissionSectionConfig[] {
  return APPLICATION_PERMISSION_KEYS.map((key) => {
    const disabledTooltip = getDisabledTooltip(group, key);
    const value = getApplicationPermissionValue(graph, edits, group.id, key);

    return {
      permission: DataPermission.APPLICATION,
      type: PERMISSION_TYPES[key],
      value: value === "yes" ? DataPermissionValue.YES : DataPermissionValue.NO,
      isDisabled: disabledTooltip != null,
      disabledTooltip,
      isHighlighted: isAdminGroup(group),
      options: [YES_OPTION, NO_OPTION],
    };
  });
}

/**
 * One row per group in the graph, special groups first, each with a permission
 * per {@link APPLICATION_PERMISSION_KEYS} entry, in that order.
 */
export function getApplicationPermissionsEntities(
  graph: ApplicationPermissionsGraph,
  edits: ApplicationPermissionsEdits,
  groups: GroupInfo[],
): PermissionEditorEntity[] {
  return groups
    .filter((group) => group.id in graph.groups)
    .sort(
      (a, b) =>
        getGroupSortOrder(a) - getGroupSortOrder(b) ||
        a.name.localeCompare(b.name),
    )
    .map((group) => ({
      id: group.id,
      name: getGroupNameLocalized(group),
      permissions: getGroupPermissions(graph, edits, group),
    }));
}
