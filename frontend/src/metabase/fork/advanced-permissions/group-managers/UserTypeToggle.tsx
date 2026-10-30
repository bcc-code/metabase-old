import type { MouseEvent } from "react";
import { t } from "ttag";

import { ActionIcon, type FloatingPosition, Icon, Tooltip } from "metabase/ui";

interface UserTypeToggleProps {
  isManager?: boolean;
  onChange: (isManager: boolean) => void;
  tooltipPlacement?: FloatingPosition;
}

/** Promotes a group member to group manager, or demotes a manager. */
export function UserTypeToggle({
  isManager = false,
  onChange,
  tooltipPlacement = "bottom",
}: UserTypeToggleProps) {
  const label = isManager ? t`Turn into Member` : t`Turn into Manager`;

  const handleClick = (event: MouseEvent) => {
    // the toggle often sits inside a clickable group row, which must not toggle the membership itself
    event.stopPropagation();
    onChange(!isManager);
  };

  return (
    <Tooltip label={label} position={tooltipPlacement}>
      <ActionIcon variant="subtle" aria-label={label} onClick={handleClick}>
        <Icon name={isManager ? "arrow_down" : "arrow_up"} />
      </ActionIcon>
    </Tooltip>
  );
}
