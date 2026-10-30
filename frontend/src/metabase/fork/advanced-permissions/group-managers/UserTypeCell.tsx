import { t } from "ttag";

import { Flex, Text } from "metabase/ui";

import { UserTypeToggle } from "./UserTypeToggle";

interface UserTypeCellProps {
  isManager?: boolean;
  isAdmin: boolean;
  onChange: (isManager: boolean) => void;
}

/** The "Type" cell of a group member's row: whether they manage the group. */
export function UserTypeCell({
  isManager = false,
  isAdmin,
  onChange,
}: UserTypeCellProps) {
  const typeName = isAdmin ? t`Admin` : isManager ? t`Manager` : t`Member`;

  return (
    <td>
      <Flex align="center" gap="sm">
        <Text>{typeName}</Text>
        {!isAdmin && (
          <UserTypeToggle isManager={isManager} onChange={onChange} />
        )}
      </Flex>
    </td>
  );
}
