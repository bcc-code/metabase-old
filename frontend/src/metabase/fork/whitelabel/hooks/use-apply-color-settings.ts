import { useCallback } from "react";

import { useMantineTheme } from "metabase/ui";
import type { ColorSettings } from "metabase-types/api";

/**
 * Returns a function that applies saved `application-colors` to the running
 * app, so the new colors show without reloading the page. It does nothing
 * outside the app's theme provider.
 */
export function useApplyColorSettings() {
  const theme = useMantineTheme();

  return useCallback(
    (colors: ColorSettings) => {
      // only the app's root theme provider sets this callback
      const { updateColorSettings } = theme.other;
      if (typeof updateColorSettings === "function") {
        updateColorSettings(colors);
      }
    },
    [theme],
  );
}
