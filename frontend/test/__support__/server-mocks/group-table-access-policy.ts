import fetchMock from "fetch-mock";

import type {
  GroupId,
  GroupTableAccessPolicy,
  TableId,
} from "metabase-types/api";

/** `GET /api/mt/gtap` for one group and table: the policy, or `null` when there is none. */
export function setupGroupTableAccessPolicyEndpoint(
  groupId: GroupId,
  tableId: TableId,
  policy: GroupTableAccessPolicy | null,
) {
  fetchMock.get({
    url: "path:/api/mt/gtap",
    query: { group_id: groupId, table_id: tableId },
    response: policy ?? "null",
  });
}

/** `POST /api/mt/gtap/validate`: accepts the policy, or refuses it with `errorMessage`. */
export function setupValidateGroupTableAccessPolicyEndpoint(
  errorMessage?: string,
) {
  fetchMock.post(
    "path:/api/mt/gtap/validate",
    errorMessage != null
      ? { status: 400, body: { message: errorMessage } }
      : { status: 204 },
  );
}
