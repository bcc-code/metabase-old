import { useDisclosure } from "@mantine/hooks";
import { t } from "ttag";

import { ConfirmModal } from "metabase/common/components/ConfirmModal";
import { useAdminSetting } from "metabase/settings";
import { SettingsSection } from "metabase/settings-components";
import { Box, Button, Group } from "metabase/ui";

import {
  BCC_THEME_COLORS,
  BCC_THEME_FONT,
  BCC_THEME_SWATCHES,
} from "../../bcc-theme";
import { useApplyColorSettings } from "../../hooks/use-apply-color-settings";

/**
 * Applies BCC's colors and font in one step. The logo, name and every other
 * setting stay as they are.
 */
export function BccThemeSection() {
  const [isConfirmOpen, { open: openConfirm, close: closeConfirm }] =
    useDisclosure(false);
  const { updateSettings } = useAdminSetting("application-colors");
  const applyColorSettings = useApplyColorSettings();

  const handleConfirm = async () => {
    const { error } = await updateSettings({
      "application-colors": BCC_THEME_COLORS,
      "application-font": BCC_THEME_FONT,
      "application-font-files": null,
    });
    if (!error) {
      applyColorSettings(BCC_THEME_COLORS);
      closeConfirm();
    }
  };

  return (
    <SettingsSection
      title={t`BCC theme`}
      description={t`Use the colors and the Archivo typeface of the BCC Design System. Your application name, logo and other settings stay as they are, and you can still change each color afterwards.`}
      data-testid="bcc-theme-section"
    >
      <Group gap="xs" aria-hidden>
        {BCC_THEME_SWATCHES.map((color) => (
          <Box
            key={color}
            w="1.5rem"
            h="1.5rem"
            bdrs="50%"
            bd="1px solid border-neutral"
            style={{ backgroundColor: color }}
          />
        ))}
      </Group>
      <Group>
        <Button variant="filled" onClick={openConfirm}>
          {t`Use BCC theme`}
        </Button>
      </Group>
      <ConfirmModal
        opened={isConfirmOpen}
        title={t`Use the BCC theme?`}
        message={t`This replaces the interface colors, chart colors and font with BCC's.`}
        confirmButtonText={t`Use BCC theme`}
        confirmButtonProps={{ color: "brand" }}
        onConfirm={handleConfirm}
        onClose={closeConfirm}
      />
    </SettingsSection>
  );
}
