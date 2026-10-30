import { useState } from "react";
import { t } from "ttag";

import {
  Alert,
  Autocomplete,
  Button,
  Group,
  Icon,
  Stack,
  Text,
} from "metabase/ui";
import type { UserAttributeKey } from "metabase-types/api";

export interface ImpersonationFormProps {
  databaseName: string;
  requiresDefaultRole: boolean;
  initialAttribute: UserAttributeKey | null;
  attributes: UserAttributeKey[];
  onSave: (attribute: UserAttributeKey) => void;
  onCancel: () => void;
}

export function ImpersonationForm({
  databaseName,
  requiresDefaultRole,
  initialAttribute,
  attributes,
  onSave,
  onCancel,
}: ImpersonationFormProps) {
  const [attribute, setAttribute] = useState(initialAttribute ?? "");
  const trimmed = attribute.trim();

  return (
    <Stack gap="lg">
      <Text>
        {t`Queries people in this group run against ${databaseName} will use the database role named by their user attribute, so the database's own grants decide which rows and columns they see. The roles and their grants have to exist in the database.`}
      </Text>
      {requiresDefaultRole && (
        <Alert color="warning" icon={<Icon name="warning" />}>
          {t`This database needs a default role in its connection settings, used for people who aren't impersonated.`}
        </Alert>
      )}
      <Autocomplete
        label={t`User attribute holding the database role`}
        placeholder={t`Pick or type an attribute`}
        data={attributes}
        value={attribute}
        onChange={setAttribute}
      />
      {attributes.length === 0 && (
        <Text c="text-secondary" size="sm">
          {t`No user has attributes yet. Add them to people in Admin > People, or have your identity provider send them.`}
        </Text>
      )}
      <Group justify="flex-end" gap="sm">
        <Button onClick={onCancel}>{t`Cancel`}</Button>
        <Button
          variant="filled"
          disabled={trimmed === ""}
          onClick={() => onSave(trimmed)}
        >
          {t`Save`}
        </Button>
      </Group>
    </Stack>
  );
}
