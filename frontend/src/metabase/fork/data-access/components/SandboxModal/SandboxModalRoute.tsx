import { useNavigate, useParams } from "metabase/router";

import { parseRouteId } from "../../route-params";
import { type PermissionsView, getSandboxParentUrl } from "../../urls";

import { SandboxModal } from "./SandboxModal";

type SandboxRouteParam =
  | "groupId"
  | "databaseId"
  | "schemaName"
  | "tableId"
  | "sandboxGroupId"
  | "sandboxTableId";

/**
 * The row and column security editor, opened over the data permissions
 * editor: from a group's tables (`segmented/table/:sandboxTableId`) or from a
 * table's groups (`segmented/group/:sandboxGroupId`).
 */
export function SandboxModalRoute({ view }: { view: PermissionsView }) {
  const params = useParams<SandboxRouteParam>();
  const navigate = useNavigate();
  const groupId = parseRouteId(
    view === "group" ? params.groupId : params.sandboxGroupId,
  );
  const tableId = parseRouteId(
    view === "group" ? params.sandboxTableId : params.tableId,
  );
  const databaseId = parseRouteId(params.databaseId);

  if (groupId == null || tableId == null || databaseId == null) {
    return null;
  }

  const entityId = { databaseId, schemaName: params.schemaName, tableId };

  return (
    <SandboxModal
      groupId={groupId}
      entityId={entityId}
      view={view}
      onClose={() => navigate(getSandboxParentUrl(groupId, entityId, view))}
    />
  );
}
