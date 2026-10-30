import { t } from "ttag";

import {
  skipToken,
  useGetDatabaseQuery,
  useListUserAttributesQuery,
} from "metabase/api";
import { LoadingAndErrorWrapper } from "metabase/common/components/LoadingAndErrorWrapper";
import { updateDataPermission } from "metabase/permissions";
import { useDispatch, useSelector } from "metabase/redux";
import { Modal } from "metabase/ui";
import {
  DataPermission,
  DataPermissionType,
  DataPermissionValue,
  type DatabaseId,
  type GroupId,
  type UserAttributeKey,
} from "metabase-types/api";

import { useListImpersonationsQuery } from "../../api";
import { getImpersonationChange } from "../../selectors";
import { impersonationChanged } from "../../state";
import type { PermissionsView } from "../../urls";

import { ImpersonationForm } from "./ImpersonationForm";

export interface ImpersonationModalProps {
  groupId: GroupId;
  databaseId: DatabaseId;
  view: PermissionsView;
  onClose: () => void;
}

/**
 * Edits the connection impersonation policy of a group on a database. Saving
 * records the policy and marks the database as impersonated in the
 * permissions editor; both are sent to the server when the admin saves.
 */
export function ImpersonationModal({
  groupId,
  databaseId,
  view,
  onClose,
}: ImpersonationModalProps) {
  const dispatch = useDispatch();
  const change = useSelector((state) =>
    getImpersonationChange(state, groupId, databaseId),
  );
  const databaseQuery = useGetDatabaseQuery({ id: databaseId });
  const savedQuery = useListImpersonationsQuery(
    change ? skipToken : { "group-id": groupId, "db-id": databaseId },
  );
  const attributesQuery = useListUserAttributesQuery();
  const initialAttribute =
    change?.attribute ?? savedQuery.data?.[0]?.attribute ?? null;

  const handleSave = (attribute: UserAttributeKey) => {
    dispatch(
      impersonationChanged({ group_id: groupId, db_id: databaseId, attribute }),
    );
    dispatch(
      updateDataPermission({
        groupId,
        permission: {
          type: DataPermissionType.ACCESS,
          permission: DataPermission.VIEW_DATA,
        },
        value: DataPermissionValue.IMPERSONATED,
        entityId: { databaseId },
        view,
      }),
    );
    onClose();
  };

  const database = databaseQuery.data;

  return (
    <Modal
      opened
      size="lg"
      title={t`Map a user attribute to database roles`}
      onClose={onClose}
    >
      <LoadingAndErrorWrapper
        loading={
          databaseQuery.isLoading ||
          savedQuery.isLoading ||
          attributesQuery.isLoading
        }
        error={databaseQuery.error ?? savedQuery.error}
      >
        {database && (
          <ImpersonationForm
            databaseName={database.name}
            requiresDefaultRole={(database.features ?? []).includes(
              "connection-impersonation-requires-role",
            )}
            initialAttribute={initialAttribute}
            attributes={attributesQuery.data ?? []}
            onSave={handleSave}
            onCancel={onClose}
          />
        )}
      </LoadingAndErrorWrapper>
    </Modal>
  );
}
