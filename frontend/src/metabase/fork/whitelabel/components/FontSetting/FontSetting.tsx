import { useState } from "react";
import { t } from "ttag";
import _ from "underscore";

import { SetByEnvVar } from "metabase/common/components/SetByEnvVar";
import { useAdminSettings, useSetting } from "metabase/settings";
import { SettingHeader } from "metabase/settings-components";
import { Box, Select, Stack, Text, TextInput } from "metabase/ui";
import type { FontFile } from "metabase-types/api";

import {
  CUSTOM_FONT_WEIGHTS,
  type CustomFontWeight,
  WEB_SAFE_FONTS,
  getCustomFontWeightLabel,
} from "../../constants";
import {
  type CustomFontUrls,
  type FontUrlError,
  getCustomFontUrls,
  getFontFiles,
  getFontUrlError,
} from "../../utils/fonts";

// not a font name: those come from folder names and the web-safe font list
const CUSTOM_FONT_VALUE = "custom-font-files";

const FONT_SETTING_KEYS = [
  "application-font",
  "application-font-files",
] as const;

/**
 * Picks the `application-font`: a bundled font, a web-safe font from the
 * viewer's system, or the admin's own font files in `application-font-files`.
 */
export function FontSetting() {
  const { values, details, updateSettings, isLoading } =
    useAdminSettings(FONT_SETTING_KEYS);
  const availableFonts = useSetting("available-fonts") ?? [];
  const fontFiles = values["application-font-files"];
  const hasFontFiles = fontFiles != null && fontFiles.length > 0;
  // "Custom…" is picked, but no font file is saved yet
  const [isCustomPending, setIsCustomPending] = useState(false);
  const isCustomSelected = hasFontFiles || isCustomPending;

  const envDetails = FONT_SETTING_KEYS.map((key) => details[key]).find(
    (settingDetails) => settingDetails?.is_env_setting,
  );

  if (isLoading) {
    return null;
  }

  const handleFontChange = async (font: string | null) => {
    if (font === CUSTOM_FONT_VALUE) {
      setIsCustomPending(true);
      return;
    }
    if (!font) {
      return;
    }
    setIsCustomPending(false);
    await updateSettings({
      "application-font": font,
      "application-font-files": null,
    });
  };

  const data = [
    {
      group: t`Included fonts`,
      items: availableFonts.map((font) => ({ value: font, label: font })),
    },
    {
      group: t`System fonts`,
      items: WEB_SAFE_FONTS.map((font) => ({ value: font, label: font })),
    },
    {
      group: t`Your own font`,
      items: [{ value: CUSTOM_FONT_VALUE, label: t`Custom…` }],
    },
  ];

  return (
    <Stack gap="md" data-testid="application-font-setting">
      <SettingHeader
        id="application-font"
        title={t`Font`}
        description={t`Included fonts are served by this instance. System fonts, like Arial, come with the viewer's computer, which falls back to a similar font when it doesn't have them.`}
      />
      {envDetails?.env_name ? (
        <SetByEnvVar varName={envDetails.env_name} />
      ) : (
        <>
          <Select
            id="application-font"
            data={data}
            value={
              isCustomSelected ? CUSTOM_FONT_VALUE : values["application-font"]
            }
            onChange={handleFontChange}
            searchable
            maw="20rem"
          />
          {isCustomSelected && (
            <CustomFontFilesInput
              fontFiles={fontFiles}
              onSave={async (files) => {
                const { error } = await updateSettings({
                  "application-font-files": files.length > 0 ? files : null,
                });
                if (!error) {
                  setIsCustomPending(false);
                }
              }}
            />
          )}
        </>
      )}
    </Stack>
  );
}

interface CustomFontFilesInputProps {
  fontFiles: FontFile[] | null | undefined;
  onSave: (fontFiles: FontFile[]) => Promise<void>;
}

const getFontUrlErrorMessage = (error: FontUrlError): string => {
  switch (error) {
    case "invalid-url":
      return t`Enter a full URL, starting with https://`;
    case "unsupported-format":
      return t`Use a .woff2, .woff or .ttf file`;
  }
};

function CustomFontFilesInput({
  fontFiles,
  onSave,
}: CustomFontFilesInputProps) {
  const [urls, setUrls] = useState<CustomFontUrls>(() =>
    getCustomFontUrls(fontFiles),
  );
  const [errors, setErrors] = useState<
    Partial<Record<CustomFontWeight, FontUrlError>>
  >({});

  const handleBlur = async () => {
    const nextErrors = Object.fromEntries(
      CUSTOM_FONT_WEIGHTS.flatMap((weight) => {
        const url = urls[weight]?.trim();
        const error = url ? getFontUrlError(url) : null;
        return error ? [[weight, error]] : [];
      }),
    );
    setErrors(nextErrors);

    const nextFontFiles = getFontFiles(urls);
    const hasErrors = Object.keys(nextErrors).length > 0;
    const isUnchanged = _.isEqual(nextFontFiles, fontFiles ?? []);
    if (!hasErrors && !isUnchanged) {
      await onSave(nextFontFiles);
    }
  };

  return (
    <Box pl="md" data-testid="custom-font-files">
      <Text c="text-secondary" mb="sm" maw="38rem">
        {t`Tell us where to find the file for each font weight. You don't need all of them, but text looks best with at least Regular and Bold.`}
      </Text>
      <Stack gap="sm" maw="32rem">
        {CUSTOM_FONT_WEIGHTS.map((weight) => {
          const error = errors[weight];
          return (
            <TextInput
              key={weight}
              label={getCustomFontWeightLabel(weight)}
              placeholder="https://example.com/fonts/my-font.woff2"
              value={urls[weight] ?? ""}
              error={error ? getFontUrlErrorMessage(error) : undefined}
              onChange={(event) => {
                const url = event.target.value;
                setUrls((current) => ({ ...current, [weight]: url }));
              }}
              onBlur={handleBlur}
            />
          );
        })}
      </Stack>
    </Box>
  );
}
