import { t } from "ttag";

import { useLocation } from "metabase/router";
import { useSetting } from "metabase/settings";
import * as Urls from "metabase/urls";

import { SettingsNavItem } from "./SettingsNavItem";

export const CustomVisualizationsNav = () => {
  const customVizDevModeEnabled = useSetting(
    "custom-viz-plugin-dev-mode-enabled",
  );

  const pathname = useLocation().pathname;
  const hasSubNav = customVizDevModeEnabled;
  const isManageVisualizationsActive =
    pathname.startsWith(Urls.customVizAdd()) ||
    pathname.startsWith(Urls.customVizEdit(undefined));

  return (
    <SettingsNavItem
      active={isManageVisualizationsActive && !hasSubNav ? true : undefined}
      path={hasSubNav ? undefined : "custom-visualizations"}
      folderPattern="custom-visualizations"
      label={t`Custom visualizations`}
      icon="bar"
    >
      {hasSubNav && (
        <>
          <SettingsNavItem
            key="manage"
            path="custom-visualizations"
            active={isManageVisualizationsActive ? true : undefined}
            label={t`Manage visualizations`}
          />
          <SettingsNavItem
            key="dev"
            path="custom-visualizations/development"
            label={t`Development`}
          />
        </>
      )}
    </SettingsNavItem>
  );
};
