import { useMemo, useRef, useState } from "react";
import { t } from "ttag";

import { QuestionPickerModal } from "metabase/common/components/Pickers";
import {
  ActionIcon,
  Alert,
  Autocomplete,
  Button,
  Group,
  Icon,
  Radio,
  Select,
  Stack,
  Text,
} from "metabase/ui";
import type {
  Card,
  CardId,
  GroupTableAccessPolicyDraft,
  ParameterTarget,
  UserAttributeKey,
} from "metabase-types/api";

import { type TargetOption, getTargetKey } from "../../targets";

type SandboxMode = "table" | "question";

interface RemappingRow {
  id: number;
  attribute: UserAttributeKey;
  targetKey: string | null;
}

export interface SandboxFormProps {
  tableName: string;
  initialSandbox: Pick<
    GroupTableAccessPolicyDraft,
    "card_id" | "attribute_remappings"
  > | null;
  attributes: UserAttributeKey[];
  tableTargets: TargetOption[];
  /** The question chosen to restrict the table, once loaded. */
  card: Card | undefined;
  questionTargets: TargetOption[];
  isSaving: boolean;
  error: string | null;
  onCardChange: (cardId: CardId | null) => void;
  onSave: (
    sandbox: Pick<
      GroupTableAccessPolicyDraft,
      "card_id" | "attribute_remappings"
    >,
  ) => void;
  onCancel: () => void;
}

const getInitialRows = (
  remappings: Record<UserAttributeKey, ParameterTarget> | undefined,
): RemappingRow[] =>
  Object.entries(remappings ?? {}).map(([attribute, target], index) => ({
    id: index,
    attribute,
    targetKey: getTargetKey(target),
  }));

export function SandboxForm({
  tableName,
  initialSandbox,
  attributes,
  tableTargets,
  card,
  questionTargets,
  isSaving,
  error,
  onCardChange,
  onSave,
  onCancel,
}: SandboxFormProps) {
  const [mode, setMode] = useState<SandboxMode>(
    initialSandbox?.card_id != null ? "question" : "table",
  );
  const [cardId, setCardId] = useState<CardId | null>(
    initialSandbox?.card_id ?? null,
  );
  const [rows, setRows] = useState<RemappingRow[]>(() =>
    getInitialRows(initialSandbox?.attribute_remappings),
  );
  const nextRowId = useRef(rows.length);
  const [isPickingQuestion, setIsPickingQuestion] = useState(false);

  const targets = mode === "question" ? questionTargets : tableTargets;
  const targetsByKey = useMemo(
    () => new Map(targets.map((option) => [option.key, option])),
    [targets],
  );

  const completeRows = rows.filter(
    (row) =>
      row.attribute.trim() !== "" &&
      row.targetKey != null &&
      targetsByKey.has(row.targetKey),
  );
  const hasIncompleteRows = completeRows.length !== rows.length;
  const canSave =
    !isSaving &&
    !hasIncompleteRows &&
    (mode === "question" ? cardId != null : completeRows.length > 0);

  const handleModeChange = (value: string) => {
    const nextMode: SandboxMode = value === "question" ? "question" : "table";
    setMode(nextMode);
    setRows([]);
    const nextCardId = nextMode === "question" ? cardId : null;
    onCardChange(nextCardId);
  };

  const handleCardChange = (id: CardId) => {
    setCardId(id);
    setRows([]);
    onCardChange(id);
    setIsPickingQuestion(false);
  };

  const updateRow = (id: number, change: Partial<RemappingRow>) =>
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...change } : row)),
    );

  const handleSave = () => {
    const remappings = Object.fromEntries(
      completeRows.flatMap((row) => {
        const option =
          row.targetKey != null ? targetsByKey.get(row.targetKey) : undefined;
        return option ? [[row.attribute.trim(), option.target]] : [];
      }),
    );
    onSave({
      card_id: mode === "question" ? cardId : null,
      attribute_remappings: remappings,
    });
  };

  return (
    <Stack gap="lg">
      <Radio.Group
        value={mode}
        onChange={handleModeChange}
        label={t`How should the data of ${tableName} be restricted?`}
      >
        <Stack gap="sm" mt="sm">
          <Radio
            value="table"
            label={t`Filter by a column in the table`}
            description={t`People only see the rows whose column matches one of their attributes.`}
          />
          <Radio
            value="question"
            label={t`Use a saved question to create a custom view for this table`}
            description={t`People see the rows and columns the question returns. The question may only return columns of this table.`}
          />
        </Stack>
      </Radio.Group>

      {mode === "question" && (
        <Group gap="sm">
          <Button
            leftSection={<Icon name="table" />}
            onClick={() => setIsPickingQuestion(true)}
          >
            {cardId != null ? t`Change question` : t`Choose a question`}
          </Button>
          {cardId != null && (
            <Text fw="bold">{card?.name ?? t`Loading question…`}</Text>
          )}
        </Group>
      )}

      <Stack gap="sm">
        <Text fw="bold">{t`Filter by user attributes`}</Text>
        <Text c="text-secondary" size="sm">
          {mode === "question"
            ? t`Optionally pass user attributes to the question, as values of its variables or to filter its columns.`
            : t`Each row of the table is shown to a person only if its column matches their attribute.`}
        </Text>
        {rows.map((row) => (
          <Group key={row.id} gap="sm" wrap="nowrap" align="flex-end">
            <Autocomplete
              flex={1}
              label={t`User attribute`}
              placeholder={t`Pick or type an attribute`}
              data={attributes}
              value={row.attribute}
              onChange={(attribute) => updateRow(row.id, { attribute })}
            />
            <Select
              flex={1}
              label={
                mode === "question"
                  ? t`Column or variable`
                  : t`Column of the table`
              }
              placeholder={t`Pick a column`}
              data={targets.map((option) => ({
                value: option.key,
                label: option.label,
              }))}
              value={row.targetKey}
              onChange={(targetKey) => updateRow(row.id, { targetKey })}
              searchable
            />
            <ActionIcon
              aria-label={t`Remove filter`}
              variant="subtle"
              mb="xs"
              onClick={() =>
                setRows((current) => current.filter(({ id }) => id !== row.id))
              }
            >
              <Icon name="close" />
            </ActionIcon>
          </Group>
        ))}
        <Group>
          <Button
            variant="subtle"
            leftSection={<Icon name="add" />}
            disabled={mode === "question" && cardId == null}
            onClick={() =>
              setRows((current) => [
                ...current,
                { id: nextRowId.current++, attribute: "", targetKey: null },
              ])
            }
          >
            {t`Add a filter`}
          </Button>
        </Group>
      </Stack>

      {error != null && (
        <Alert color="error" icon={<Icon name="warning" />}>
          {error}
        </Alert>
      )}

      <Group justify="flex-end" gap="sm">
        <Button onClick={onCancel}>{t`Cancel`}</Button>
        <Button
          variant="filled"
          disabled={!canSave}
          loading={isSaving}
          onClick={handleSave}
        >
          {t`Save`}
        </Button>
      </Group>

      {isPickingQuestion && (
        <QuestionPickerModal
          title={t`Choose a question or model`}
          onChange={(item) => handleCardChange(item.id)}
          onClose={() => setIsPickingQuestion(false)}
        />
      )}
    </Stack>
  );
}
