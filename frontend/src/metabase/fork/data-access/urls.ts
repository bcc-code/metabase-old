import {
  getDatabaseFocusPermissionsUrl,
  getGroupFocusPermissionsUrl,
} from "metabase/permissions";
import type { DatabaseId, GroupId, TableEntityId } from "metabase-types/api";

/** Which side of the data permissions editor a change was made from. */
export type PermissionsView = "database" | "group";

/** The editor page the row and column security editor of a table opens over. */
export function getSandboxParentUrl(
  groupId: GroupId,
  { databaseId, schemaName, tableId }: TableEntityId,
  view: PermissionsView,
): string {
  if (view === "database") {
    return getDatabaseFocusPermissionsUrl({ databaseId, schemaName, tableId });
  }
  return schemaName
    ? getGroupFocusPermissionsUrl(groupId, { databaseId, schemaName })
    : getGroupFocusPermissionsUrl(groupId, { databaseId });
}

export function getSandboxUrl(
  groupId: GroupId,
  entityId: TableEntityId,
  view: PermissionsView,
): string {
  const parentUrl = getSandboxParentUrl(groupId, entityId, view);
  return view === "group"
    ? `${parentUrl}/segmented/table/${entityId.tableId}`
    : `${parentUrl}/segmented/group/${groupId}`;
}

/** The editor page the connection impersonation editor of a database opens over. */
export function getImpersonationParentUrl(
  groupId: GroupId,
  databaseId: DatabaseId,
  view: PermissionsView,
): string {
  return view === "group"
    ? getGroupFocusPermissionsUrl(groupId)
    : getDatabaseFocusPermissionsUrl({ databaseId });
}

export function getImpersonationUrl(
  groupId: GroupId,
  databaseId: DatabaseId,
  view: PermissionsView,
): string {
  const parentUrl = getImpersonationParentUrl(groupId, databaseId, view);
  return view === "group"
    ? `${parentUrl}/impersonated/database/${databaseId}`
    : `${parentUrl}/impersonated/group/${groupId}`;
}
