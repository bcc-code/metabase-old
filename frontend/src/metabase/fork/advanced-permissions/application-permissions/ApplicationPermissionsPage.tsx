import { useCallback, useMemo, useState } from "react";
import { t } from "ttag";

import { PermissionsEditor } from "metabase/admin/permissions/components/PermissionsEditor";
import { PermissionsPageLayout } from "metabase/admin/permissions/components/PermissionsPageLayout";
import { useListPermissionsGroupsQuery } from "metabase/api";
import { getErrorMessage } from "metabase/api/utils";
import { useToast } from "metabase/common/hooks/use-toast";
import {
  ApplicationPermissionsHelp,
  type PermissionEditorEntity,
  type PermissionSectionConfig,
  assertNumericId,
} from "metabase/permissions";
import type { DataPermissionValue } from "metabase-types/api";

import {
  useGetApplicationPermissionsGraphQuery,
  useUpdateApplicationPermissionsGraphMutation,
} from "../api";

import {
  type ApplicationPermissionsEdits,
  getApplicationPermissionKey,
  getApplicationPermissionsColumns,
  getApplicationPermissionsEntities,
  toApplicationPermissionValue,
  updateApplicationPermissionsEdits,
} from "./utils";

/**
 * Admin > Permissions > Application: which groups may access the admin
 * settings, use the monitoring tools, and create subscriptions and alerts.
 */
export function ApplicationPermissionsPage() {
  const {
    data: graph,
    isLoading: isLoadingGraph,
    error: graphError,
    refetch: refetchGraph,
  } = useGetApplicationPermissionsGraphQuery();
  const {
    data: groups,
    isLoading: isLoadingGroups,
    error: groupsError,
  } = useListPermissionsGroupsQuery({});
  const [updateGraph] = useUpdateApplicationPermissionsGraphMutation();
  const [sendToast] = useToast();
  const [edits, setEdits] = useState<ApplicationPermissionsEdits>({});

  const isDirty = Object.keys(edits).length > 0;
  const error = graphError ?? groupsError;

  const entities = useMemo(
    () =>
      graph && groups
        ? getApplicationPermissionsEntities(graph, edits, groups)
        : [],
    [graph, edits, groups],
  );

  const handleChange = useCallback(
    (
      entity: PermissionEditorEntity,
      permission: PermissionSectionConfig,
      value: DataPermissionValue,
    ) => {
      const key = getApplicationPermissionKey(permission.type);
      if (graph && key) {
        setEdits((currentEdits) =>
          updateApplicationPermissionsEdits(
            currentEdits,
            graph,
            assertNumericId(entity.id),
            key,
            toApplicationPermissionValue(value),
          ),
        );
      }
    },
    [graph],
  );

  const handleSave = async () => {
    if (!graph) {
      return;
    }
    try {
      await updateGraph({ revision: graph.revision, groups: edits }).unwrap();
      setEdits({});
    } catch (saveError) {
      // someone else may have changed the graph: keep the edits, on top of the latest revision
      refetchGraph();
      sendToast({
        message: getErrorMessage(
          saveError,
          t`The application permissions couldn't be saved.`,
        ),
        variant: "negative",
      });
    }
  };

  return (
    <PermissionsPageLayout
      tab="application"
      isDirty={isDirty}
      onSave={handleSave}
      onLoad={() => setEdits({})}
      helpContent={<ApplicationPermissionsHelp />}
    >
      <PermissionsEditor
        isLoading={isLoadingGraph || isLoadingGroups}
        error={error ? getErrorMessage(error) : undefined}
        title={t`Application settings permissions`}
        filterPlaceholder={t`Search for a group`}
        columns={getApplicationPermissionsColumns()}
        entities={entities}
        onChange={handleChange}
      />
    </PermissionsPageLayout>
  );
}
