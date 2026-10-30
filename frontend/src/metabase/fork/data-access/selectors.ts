import {
  getFieldsPermission,
  getSchemasPermission,
} from "metabase/permissions";
import type { State } from "metabase/redux/store";
import {
  DataPermission,
  DataPermissionValue,
  type DatabaseId,
  type GroupId,
  type GroupTableAccessPolicyDraft,
  type Impersonation,
  type TableId,
} from "metabase-types/api";

import {
  type DataAccessState,
  EMPTY_DATA_ACCESS_STATE,
  type SandboxChange,
} from "./state";

/** The key of the plugin reducer slot the slice is registered under. */
export const DATA_ACCESS_STATE_KEY = "sandboxingPlugin";

function isDataAccessState(value: unknown): value is DataAccessState {
  // Only this plugin's reducer writes under its key, so its shape is ours.
  return (
    typeof value === "object" &&
    value !== null &&
    "sandboxes" in value &&
    Array.isArray(value.sandboxes) &&
    "impersonations" in value &&
    Array.isArray(value.impersonations)
  );
}

/** The policies edited in the permissions editor and not saved yet. */
export function getDataAccessState(state: State): DataAccessState {
  // `State` doesn't describe the plugin reducers, which are registered at boot.
  const root: object = state;
  const plugins = "plugins" in root ? root.plugins : undefined;
  const slice =
    typeof plugins === "object" &&
    plugins !== null &&
    DATA_ACCESS_STATE_KEY in plugins
      ? plugins[DATA_ACCESS_STATE_KEY]
      : undefined;
  return isDataAccessState(slice) ? slice : EMPTY_DATA_ACCESS_STATE;
}

export function getSandboxChange(
  state: State,
  groupId: GroupId,
  tableId: TableId,
): SandboxChange | undefined {
  return getDataAccessState(state).sandboxes.find(
    ({ sandbox }) =>
      sandbox.group_id === groupId && sandbox.table_id === tableId,
  );
}

export function getImpersonationChange(
  state: State,
  groupId: GroupId,
  databaseId: DatabaseId,
): Impersonation | undefined {
  return getDataAccessState(state).impersonations.find(
    (impersonation) =>
      impersonation.group_id === groupId && impersonation.db_id === databaseId,
  );
}

/** Edited sandboxes whose tables are still sandboxed in the edited graph. */
function getSandboxesToSave(state: State): GroupTableAccessPolicyDraft[] {
  const permissions = state.admin.permissions.dataPermissions;
  if (permissions == null) {
    return [];
  }
  return getDataAccessState(state)
    .sandboxes.filter(
      ({ entityId, sandbox }) =>
        getFieldsPermission(
          permissions,
          sandbox.group_id,
          entityId,
          DataPermission.VIEW_DATA,
        ) === DataPermissionValue.SANDBOXED,
    )
    .map(({ sandbox }) => sandbox);
}

/** Edited impersonation policies whose databases are still impersonated in the edited graph. */
function getImpersonationsToSave(state: State): Impersonation[] {
  const permissions = state.admin.permissions.dataPermissions;
  if (permissions == null) {
    return [];
  }
  return getDataAccessState(state).impersonations.filter(
    (impersonation) =>
      getSchemasPermission(
        permissions,
        impersonation.group_id,
        { databaseId: impersonation.db_id },
        DataPermission.VIEW_DATA,
      ) === DataPermissionValue.IMPERSONATED,
  );
}

/** The `sandboxes` to send with the permissions graph, and the groups they belong to. */
export function getSandboxesPayload(
  state: State,
): [{ sandboxes?: GroupTableAccessPolicyDraft[] }, string[]] {
  const sandboxes = getSandboxesToSave(state);
  return [
    sandboxes.length > 0 ? { sandboxes } : {},
    sandboxes.map((sandbox) => String(sandbox.group_id)),
  ];
}

/** The `impersonations` to send with the permissions graph, and the groups they belong to. */
export function getImpersonationsPayload(
  state: State,
): [{ impersonations?: Impersonation[] }, string[]] {
  const impersonations = getImpersonationsToSave(state);
  return [
    impersonations.length > 0 ? { impersonations } : {},
    impersonations.map((impersonation) => String(impersonation.group_id)),
  ];
}

export function hasDataAccessChanges(state: State): boolean {
  const { sandboxes, impersonations } = getDataAccessState(state);
  return sandboxes.length > 0 || impersonations.length > 0;
}
