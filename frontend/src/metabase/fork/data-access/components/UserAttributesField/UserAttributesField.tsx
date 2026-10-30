import { useField } from "formik";
import { useRef, useState } from "react";
import { t } from "ttag";

import { skipToken, useGetUserQuery } from "metabase/api";
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Icon,
  Input,
  Stack,
  Text,
  TextInput,
} from "metabase/ui";
import type {
  StructuredUserAttributes,
  UserAttributeKey,
  UserAttributeMap,
  UserAttributeValue,
  UserId,
} from "metabase-types/api";

const FIELD_NAME = "login_attributes";

interface AttributeRow {
  id: number;
  key: UserAttributeKey;
  value: UserAttributeValue;
}

const toAttributeMap = (rows: AttributeRow[]): UserAttributeMap =>
  Object.fromEntries(
    rows
      .filter((row) => row.key.trim() !== "")
      .map((row) => [row.key.trim(), row.value]),
  );

/** The attributes the user's identity provider sent, as `[name, value]` pairs. */
export function getSsoAttributes(
  attributes: StructuredUserAttributes | undefined,
): [UserAttributeKey, UserAttributeValue][] {
  return Object.entries(attributes ?? {}).flatMap(([key, attribute]) => {
    if (attribute.source === "jwt") {
      return [[key, attribute.value]];
    }
    if (attribute.original?.source === "jwt") {
      return [[key, attribute.original.value]];
    }
    return [];
  });
}

interface UserAttributesFieldProps {
  userId?: UserId | null;
  className?: string;
}

/**
 * Edits the attributes an admin sets on a user (`login_attributes`), which row
 * and column security and connection impersonation use. Attributes the user's
 * identity provider sends are listed too; one set here with the same name
 * takes precedence.
 */
export function UserAttributesField({
  userId,
  className,
}: UserAttributesFieldProps) {
  const [field, , helpers] = useField<UserAttributeMap | null | undefined>(
    FIELD_NAME,
  );
  const nextId = useRef(0);
  const [rows, setRows] = useState<AttributeRow[]>(() =>
    Object.entries(field.value ?? {}).map(([key, value]) => ({
      id: nextId.current++,
      key,
      value,
    })),
  );
  const { data: user } = useGetUserQuery(userId ?? skipToken);
  const ssoAttributes = getSsoAttributes(user?.structured_attributes);

  const keys = rows.map((row) => row.key.trim()).filter((key) => key !== "");
  const hasDuplicates = new Set(keys).size !== keys.length;

  const updateRows = (nextRows: AttributeRow[]) => {
    setRows(nextRows);
    helpers.setValue(toAttributeMap(nextRows));
  };

  const updateRow = (id: number, change: Partial<AttributeRow>) =>
    updateRows(
      rows.map((row) => (row.id === id ? { ...row, ...change } : row)),
    );

  return (
    <Input.Wrapper
      className={className}
      label={t`Attributes`}
      description={t`Row and column security and connection impersonation can use these to restrict what this person sees.`}
    >
      <Stack gap="sm" mt="sm">
        {ssoAttributes.length > 0 && (
          <Box>
            <Text size="sm" fw="bold">{t`From the identity provider`}</Text>
            {ssoAttributes.map(([key, value]) => (
              <Text key={key} size="sm" c="text-secondary">
                {keys.includes(key)
                  ? t`${key}: ${value} (overridden below)`
                  : `${key}: ${value}`}
              </Text>
            ))}
          </Box>
        )}
        {rows.map((row) => (
          <Group key={row.id} gap="sm" wrap="nowrap">
            <TextInput
              flex={1}
              aria-label={t`Attribute name`}
              placeholder={t`Name`}
              value={row.key}
              onChange={(event) =>
                updateRow(row.id, { key: event.currentTarget.value })
              }
            />
            <TextInput
              flex={1}
              aria-label={t`Attribute value`}
              placeholder={t`Value`}
              value={row.value}
              onChange={(event) =>
                updateRow(row.id, { value: event.currentTarget.value })
              }
            />
            <ActionIcon
              aria-label={t`Remove attribute`}
              variant="subtle"
              onClick={() => updateRows(rows.filter(({ id }) => id !== row.id))}
            >
              <Icon name="close" />
            </ActionIcon>
          </Group>
        ))}
        {hasDuplicates && (
          <Text size="sm" c="feedback-negative" role="alert">
            {t`Each attribute name can only be used once; the last one wins.`}
          </Text>
        )}
        <Group>
          <Button
            variant="subtle"
            leftSection={<Icon name="add" />}
            onClick={() =>
              updateRows([
                ...rows,
                { id: nextId.current++, key: "", value: "" },
              ])
            }
          >
            {t`Add an attribute`}
          </Button>
        </Group>
      </Stack>
    </Input.Wrapper>
  );
}
