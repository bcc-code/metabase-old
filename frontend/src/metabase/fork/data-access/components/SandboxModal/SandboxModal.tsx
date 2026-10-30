import { useState } from "react";
import { t } from "ttag";

import {
  skipToken,
  useGetCardQuery,
  useGetGroupTableAccessPolicyQuery,
  useGetTableQueryMetadataQuery,
  useListUserAttributesQuery,
  useValidateGroupTableAccessPolicyMutation,
} from "metabase/api";
import { getErrorMessage } from "metabase/api/utils/errors";
import { LoadingAndErrorWrapper } from "metabase/common/components/LoadingAndErrorWrapper";
import { updateDataPermission } from "metabase/permissions";
import { useDispatch, useSelector } from "metabase/redux";
import { Modal } from "metabase/ui";
import {
  type CardId,
  DataPermission,
  DataPermissionType,
  DataPermissionValue,
  type GroupId,
  type GroupTableAccessPolicyDraft,
  type TableEntityId,
} from "metabase-types/api";

import { getSandboxChange } from "../../selectors";
import { sandboxChanged } from "../../state";
import { getQuestionTargetOptions, getTableTargetOptions } from "../../targets";
import type { PermissionsView } from "../../urls";

import { SandboxForm } from "./SandboxForm";

export interface SandboxModalProps {
  groupId: GroupId;
  entityId: TableEntityId;
  view: PermissionsView;
  onClose: () => void;
}

/**
 * Edits the row and column security policy of a group on a table. Saving
 * records the policy and marks the table as sandboxed in the permissions
 * editor; both are sent to the server when the admin saves the permissions.
 */
export function SandboxModal({
  groupId,
  entityId,
  view,
  onClose,
}: SandboxModalProps) {
  const dispatch = useDispatch();
  const { tableId } = entityId;
  const change = useSelector((state) =>
    getSandboxChange(state, groupId, tableId),
  );
  const tableQuery = useGetTableQueryMetadataQuery({ id: tableId });
  const savedQuery = useGetGroupTableAccessPolicyQuery(
    change ? skipToken : { group_id: groupId, table_id: tableId },
  );
  const attributesQuery = useListUserAttributesQuery();
  const initialSandbox = change?.sandbox ?? savedQuery.data ?? null;
  const [cardId, setCardId] = useState<CardId | null | undefined>(undefined);
  const effectiveCardId =
    cardId === undefined ? (initialSandbox?.card_id ?? null) : cardId;
  const cardQuery = useGetCardQuery(
    effectiveCardId != null ? { id: effectiveCardId } : skipToken,
  );
  const [validate, { isLoading: isSaving }] =
    useValidateGroupTableAccessPolicyMutation();
  const [error, setError] = useState<string | null>(null);

  const isLoading =
    tableQuery.isLoading || savedQuery.isLoading || attributesQuery.isLoading;
  const loadingError = tableQuery.error ?? savedQuery.error;

  const handleSave = async (
    edited: Pick<
      GroupTableAccessPolicyDraft,
      "card_id" | "attribute_remappings"
    >,
  ) => {
    const sandbox: GroupTableAccessPolicyDraft = {
      group_id: groupId,
      table_id: tableId,
      ...edited,
    };
    setError(null);
    try {
      await validate(sandbox).unwrap();
    } catch (validationError) {
      setError(getErrorMessage(validationError));
      return;
    }
    dispatch(sandboxChanged({ entityId, sandbox }));
    dispatch(
      updateDataPermission({
        groupId,
        permission: {
          type: DataPermissionType.ACCESS,
          permission: DataPermission.VIEW_DATA,
        },
        value: DataPermissionValue.SANDBOXED,
        entityId,
        view,
      }),
    );
    onClose();
  };

  return (
    <Modal
      opened
      size="xl"
      title={t`Configure row and column security for this table`}
      onClose={onClose}
    >
      <LoadingAndErrorWrapper loading={isLoading} error={loadingError}>
        {tableQuery.data && (
          <SandboxForm
            tableName={tableQuery.data.display_name}
            initialSandbox={initialSandbox}
            attributes={attributesQuery.data ?? []}
            tableTargets={getTableTargetOptions(tableQuery.data.fields ?? [])}
            card={cardQuery.data}
            questionTargets={
              cardQuery.data ? getQuestionTargetOptions(cardQuery.data) : []
            }
            isSaving={isSaving}
            error={error}
            onCardChange={setCardId}
            onSave={handleSave}
            onCancel={onClose}
          />
        )}
      </LoadingAndErrorWrapper>
    </Modal>
  );
}
