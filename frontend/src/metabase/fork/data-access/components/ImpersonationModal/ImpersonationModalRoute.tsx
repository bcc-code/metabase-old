import { useNavigate, useParams } from "metabase/router";

import { parseRouteId } from "../../route-params";
import { type PermissionsView, getImpersonationParentUrl } from "../../urls";

import { ImpersonationModal } from "./ImpersonationModal";

type ImpersonationRouteParam =
  | "groupId"
  | "databaseId"
  | "impersonatedGroupId"
  | "impersonatedDatabaseId";

/**
 * The connection impersonation editor, opened over the data permissions
 * editor: from a group's databases (`impersonated/database/:impersonatedDatabaseId`)
 * or from a database's groups (`impersonated/group/:impersonatedGroupId`).
 */
export function ImpersonationModalRoute({ view }: { view: PermissionsView }) {
  const params = useParams<ImpersonationRouteParam>();
  const navigate = useNavigate();
  const groupId = parseRouteId(
    view === "group" ? params.groupId : params.impersonatedGroupId,
  );
  const databaseId = parseRouteId(
    view === "group" ? params.impersonatedDatabaseId : params.databaseId,
  );

  if (groupId == null || databaseId == null) {
    return null;
  }

  return (
    <ImpersonationModal
      groupId={groupId}
      databaseId={databaseId}
      view={view}
      onClose={() =>
        navigate(getImpersonationParentUrl(groupId, databaseId, view))
      }
    />
  );
}
