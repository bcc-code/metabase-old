import { t } from "ttag";
import _ from "underscore";

import {
  Messages,
  type PermissionOption,
  type PermissionSectionConfig,
  getEntityPermission,
  getPermissionWarning,
  getPermissionWarningModal,
  getSchemasPermission,
  navigateToGranularPermissions,
} from "metabase/permissions";
import {
  DataPermission,
  DataPermissionType,
  DataPermissionValue,
  type Dataset,
  type Group,
  type GroupsPermissions,
  type PermissionEntityId,
  type PermissionSubject,
  type SpecialGroupType,
} from "metabase-types/api";

const FULL_DOWNLOAD_OPTION: PermissionOption = {
  get label() {
    return t`1 million rows`;
  },
  value: DataPermissionValue.FULL,
  icon: "check",
  iconColor: "feedback-positive",
};

const LIMITED_DOWNLOAD_OPTION: PermissionOption = {
  get label() {
    return t`10 thousand rows`;
  },
  value: DataPermissionValue.LIMITED,
  icon: "permissions_limited",
  iconColor: "feedback-warning",
};

const NO_DOWNLOAD_OPTION: PermissionOption = {
  get label() {
    return t`No`;
  },
  value: DataPermissionValue.NONE,
  icon: "close",
  iconColor: "feedback-negative",
};

const EDIT_DATA_MODEL_OPTION: PermissionOption = {
  get label() {
    return t`Edit`;
  },
  value: DataPermissionValue.ALL,
  icon: "check",
  iconColor: "feedback-positive",
};

const NO_DATA_MODEL_OPTION: PermissionOption = {
  get label() {
    return t`No`;
  },
  value: DataPermissionValue.NONE,
  icon: "close",
  iconColor: "feedback-negative",
};

const MANAGE_DATABASE_OPTION: PermissionOption = {
  get label() {
    return t`Yes`;
  },
  value: DataPermissionValue.YES,
  icon: "check",
  iconColor: "feedback-positive",
};

const NO_MANAGE_DATABASE_OPTION: PermissionOption = {
  get label() {
    return t`No`;
  },
  value: DataPermissionValue.NO,
  icon: "close",
  iconColor: "feedback-negative",
};

const GRANULAR_OPTION: PermissionOption = {
  get label() {
    return t`Granular`;
  },
  value: DataPermissionValue.CONTROLLED,
  icon: "permissions_limited",
  iconColor: "feedback-warning",
};

const ENTITY_TYPE_BY_SUBJECT: Record<PermissionSubject, string | null> = {
  schemas: "schemas",
  tables: "tables",
  fields: null,
};

export interface FeatureLevelDataPermissionsParams {
  entityId: PermissionEntityId;
  groupId: number;
  groupType: SpecialGroupType;
  permissions: GroupsPermissions;
  dataAccessPermissionValue: DataPermissionValue;
  defaultGroup: Group;
  permissionSubject: PermissionSubject;
}

/**
 * Databases and schemas can hold a different level for each of their tables;
 * a single table can't.
 */
const canBeGranular = (subject: PermissionSubject) => subject !== "fields";

function getWarnings(
  permission: DataPermission,
  value: DataPermissionValue,
  {
    entityId,
    groupId,
    permissions,
    defaultGroup,
    permissionSubject,
  }: FeatureLevelDataPermissionsParams,
): Pick<PermissionSectionConfig, "warning" | "confirmations"> {
  const defaultGroupValue = getEntityPermission(
    permissions,
    defaultGroup.id,
    entityId,
    permission,
  );
  const entityType = ENTITY_TYPE_BY_SUBJECT[permissionSubject];

  return {
    warning: getPermissionWarning(
      value,
      defaultGroupValue,
      entityType,
      defaultGroup,
      groupId,
    ),
    confirmations: (newValue: DataPermissionValue) => [
      getPermissionWarningModal(
        newValue,
        defaultGroupValue,
        entityType,
        defaultGroup,
        groupId,
      ),
    ],
  };
}

function buildDownloadPermission(
  params: FeatureLevelDataPermissionsParams,
): PermissionSectionConfig {
  const {
    entityId,
    groupId,
    groupType,
    permissions,
    dataAccessPermissionValue,
    permissionSubject,
  } = params;
  const value = getEntityPermission(
    permissions,
    groupId,
    entityId,
    DataPermission.DOWNLOAD,
  );
  const isAdmin = groupType === "admin";
  const isBlocked = dataAccessPermissionValue === DataPermissionValue.BLOCKED;
  const disabledTooltip = isAdmin
    ? Messages.UNABLE_TO_CHANGE_ADMIN_PERMISSIONS
    : isBlocked
      ? Messages.UNABLE_TO_DOWNLOAD_RESULTS
      : null;
  const isGranular = canBeGranular(permissionSubject);

  return {
    permission: DataPermission.DOWNLOAD,
    type: DataPermissionType.DOWNLOAD,
    value,
    isDisabled: disabledTooltip != null,
    disabledTooltip,
    isHighlighted: isAdmin,
    ...(disabledTooltip == null
      ? getWarnings(DataPermission.DOWNLOAD, value, params)
      : {}),
    options: _.compact([
      FULL_DOWNLOAD_OPTION,
      LIMITED_DOWNLOAD_OPTION,
      isGranular && GRANULAR_OPTION,
      NO_DOWNLOAD_OPTION,
    ]),
    postActions: isGranular
      ? {
          [DataPermissionValue.CONTROLLED]: () =>
            navigateToGranularPermissions(groupId, entityId),
        }
      : undefined,
  };
}

function getDataModelDisabledTooltip(groupType: SpecialGroupType) {
  switch (groupType) {
    case "admin":
      return Messages.UNABLE_TO_CHANGE_ADMIN_PERMISSIONS;
    case "analyst":
      return Messages.UNABLE_TO_CHANGE_DATA_ANALYST_PERMISSIONS;
    case "external":
      return Messages.EXTERNAL_USERS_NO_ACCESS_DATABASE;
    default:
      return null;
  }
}

function buildDataModelPermission(
  params: FeatureLevelDataPermissionsParams,
): PermissionSectionConfig {
  const { entityId, groupId, groupType, permissions, permissionSubject } =
    params;
  const value = getEntityPermission(
    permissions,
    groupId,
    entityId,
    DataPermission.DATA_MODEL,
  );
  const disabledTooltip = getDataModelDisabledTooltip(groupType);
  const isGranular = canBeGranular(permissionSubject);

  return {
    permission: DataPermission.DATA_MODEL,
    type: DataPermissionType.DATA_MODEL,
    value,
    isDisabled: disabledTooltip != null,
    disabledTooltip,
    isHighlighted: groupType === "admin" || groupType === "analyst",
    ...(disabledTooltip == null
      ? getWarnings(DataPermission.DATA_MODEL, value, params)
      : {}),
    options: _.compact([
      EDIT_DATA_MODEL_OPTION,
      isGranular && GRANULAR_OPTION,
      NO_DATA_MODEL_OPTION,
    ]),
    postActions: isGranular
      ? {
          [DataPermissionValue.CONTROLLED]: () =>
            navigateToGranularPermissions(groupId, entityId),
        }
      : undefined,
  };
}

function buildManageDatabasePermission(
  params: FeatureLevelDataPermissionsParams,
): PermissionSectionConfig {
  const { entityId, groupId, groupType, permissions } = params;
  const value = getSchemasPermission(
    permissions,
    groupId,
    entityId,
    DataPermission.DETAILS,
  );
  const disabledTooltip =
    groupType === "admin"
      ? Messages.UNABLE_TO_CHANGE_ADMIN_PERMISSIONS
      : groupType === "external"
        ? Messages.EXTERNAL_USERS_NO_ACCESS_DATABASE
        : null;

  return {
    permission: DataPermission.DETAILS,
    type: DataPermissionType.DETAILS,
    value,
    isDisabled: disabledTooltip != null,
    disabledTooltip,
    isHighlighted: groupType === "admin",
    ...(disabledTooltip == null
      ? getWarnings(DataPermission.DETAILS, value, params)
      : {}),
    options: [MANAGE_DATABASE_OPTION, NO_MANAGE_DATABASE_OPTION],
  };
}

/**
 * The download results, manage table metadata and (for whole databases)
 * manage database permissions of one group on one database, schema or table,
 * for the data permissions editor. Matches the columns of
 * {@link getFeatureLevelDataColumns}.
 */
export function getFeatureLevelDataPermissions(
  params: FeatureLevelDataPermissionsParams,
): PermissionSectionConfig[] {
  return _.compact([
    buildDownloadPermission(params),
    buildDataModelPermission(params),
    params.permissionSubject === "schemas" &&
      buildManageDatabasePermission(params),
  ]);
}

export function getFeatureLevelDataColumns({
  subject,
}: {
  subject: PermissionSubject;
}): { name: string }[] {
  return _.compact([
    { name: t`Download results` },
    { name: t`Manage table metadata` },
    subject === "schemas" && { name: t`Manage database` },
  ]);
}

export function canDownloadResults(result: Dataset): boolean {
  return result.data?.download_perms !== DataPermissionValue.NONE;
}

export function getDownloadWidgetMessageOverride(
  result: Dataset,
): string | null {
  return result.data?.download_perms === DataPermissionValue.LIMITED
    ? t`The maximum download size is 10 thousand rows.`
    : null;
}
