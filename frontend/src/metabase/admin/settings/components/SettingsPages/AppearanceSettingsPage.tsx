import { PLUGIN_WHITELABEL } from "metabase/plugins";

export function AppearanceSettingsPage({
  tab,
}: {
  tab?: "branding" | "conceal-metabase";
}) {
  return tab === "conceal-metabase" ? (
    <PLUGIN_WHITELABEL.WhiteLabelConcealSettingsPage />
  ) : (
    <PLUGIN_WHITELABEL.WhiteLabelBrandingSettingsPage />
  );
}
