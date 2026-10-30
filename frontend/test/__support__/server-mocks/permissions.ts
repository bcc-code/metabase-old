import fetchMock from "fetch-mock";

import type {
  ApplicationPermissionsGraph,
  CollectionPermissionsGraph,
  Database,
  Group,
  ListUserMembershipsResponse,
} from "metabase-types/api";
import { createMockPermissionsGraph } from "metabase-types/api/mocks";

export const setupPermissionsGraphEndpoints = (
  groups: Omit<Group, "members">[],
  databases: Database[],
) => {
  fetchMock.get(
    "path:/api/permissions/graph",
    createMockPermissionsGraph({ groups, databases }),
  );

  groups.forEach((group) => {
    fetchMock.get(
      `path:/api/permissions/graph/group/${group.id}`,
      createMockPermissionsGraph({ groups: [group], databases }),
    );
  });

  databases.forEach((database) => {
    fetchMock.get(
      `path:/api/permissions/graph/db/${database.id}`,
      createMockPermissionsGraph({ groups, databases: [database] }),
    );
  });
};

export const setupCollectionPermissionsGraphEndpoint = (
  permissionsGraph: CollectionPermissionsGraph,
) => {
  fetchMock.get("path:/api/collection/graph", permissionsGraph);
  fetchMock.put("path:/api/collection/graph", (call) => {
    // Unjustified type cast. FIXME
    const body = JSON.parse(call.options?.body as string);
    body.revision += 1;
    return body;
  });
};

export const setupPermissionMembershipEndpoint = (
  memberships: ListUserMembershipsResponse,
) => {
  fetchMock.get("path:/api/permissions/membership", memberships);
};

/**
 * `GET /api/permissions/application/graph` returns `graph`, and
 * `PUT /api/permissions/application/graph` returns `updatedGraph`, or fails with
 * `updateError` when that is given.
 */
export const setupApplicationPermissionsGraphEndpoints = ({
  graph,
  updatedGraph = { ...graph, revision: graph.revision + 1 },
  updateError,
}: {
  graph: ApplicationPermissionsGraph;
  updatedGraph?: ApplicationPermissionsGraph;
  updateError?: { status: number; message: string };
}) => {
  fetchMock.get("path:/api/permissions/application/graph", graph);
  fetchMock.put(
    "path:/api/permissions/application/graph",
    updateError
      ? { status: updateError.status, body: { message: updateError.message } }
      : updatedGraph,
  );
};
