import { useDebouncedCallback, useDisclosure } from "@mantine/hooks";
import { useEffect, useRef, useState } from "react";
import { t } from "ttag";
import _ from "underscore";

import { ColorInput } from "metabase/common/components/ColorInput";
import { ColorPickerContent } from "metabase/common/components/ColorPicker/ColorPickerContent";
import { ColorPill } from "metabase/common/components/ColorPill";
import { SetByEnvVar } from "metabase/common/components/SetByEnvVar";
import { useAdminSetting } from "metabase/settings";
import { SettingHeader } from "metabase/settings-components";
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Icon,
  Popover,
  SimpleGrid,
  Stack,
  Text,
  Tooltip,
} from "metabase/ui";
import { originalColors } from "metabase/ui/colors";
import type { ColorSettings } from "metabase-types/api";

import { useApplyColorSettings } from "../../hooks/use-apply-color-settings";
import {
  CHART_COLOR_KEYS,
  type EditableColorKey,
  resetApplicationColor,
  setApplicationColor,
} from "../../utils/colors";

const SAVE_DELAY_MS = 500;

interface ColorOption {
  key: EditableColorKey;
  label: string;
  description?: string;
  defaultColor: string;
}

const getInterfaceColorOptions = (): ColorOption[] => [
  {
    key: "brand",
    label: t`Primary color`,
    description: t`Buttons, links, selected items and highlights throughout the app.`,
    defaultColor: originalColors["core-brand"],
  },
  {
    key: "filter",
    label: t`Filter color`,
    description: t`Filters in the query builder and in filter widgets.`,
    defaultColor: originalColors["core-filter"],
  },
  {
    key: "summarize",
    label: t`Summarize color`,
    description: t`Summaries and groupings in the query builder.`,
    defaultColor: originalColors["core-summarize"],
  },
];

const getChartColorOptions = (): ColorOption[] =>
  CHART_COLOR_KEYS.map((key, index) => {
    const position = index + 1;
    return {
      key,
      label: t`Chart color ${position}`,
      defaultColor: originalColors[key],
    };
  });

/**
 * Edits the `application-colors` setting: the interface colors and the chart
 * colors. Changes are saved shortly after the admin stops editing and applied
 * to the running app right away.
 */
export function ColorPaletteSetting() {
  const { value, settingDetails, isLoading } =
    useAdminSetting("application-colors");

  if (isLoading) {
    return null;
  }

  if (settingDetails?.is_env_setting && settingDetails.env_name) {
    return <SetByEnvVar varName={settingDetails.env_name} />;
  }

  return <ColorPaletteForm savedColors={value ?? {}} />;
}

function ColorPaletteForm({ savedColors }: { savedColors: ColorSettings }) {
  const { updateSetting } = useAdminSetting("application-colors");
  const applyColorSettings = useApplyColorSettings();
  const [colors, setColors] = useState<ColorSettings>(savedColors);
  const lastSavedColors = useRef<ColorSettings>(savedColors);

  // Pick up colors saved elsewhere, like by the BCC theme, but not the echo of
  // our own save, which would overwrite edits made while it was in flight.
  useEffect(() => {
    if (!_.isEqual(savedColors, lastSavedColors.current)) {
      lastSavedColors.current = savedColors;
      setColors(savedColors);
    }
  }, [savedColors]);

  const saveColors = async (nextColors: ColorSettings) => {
    lastSavedColors.current = nextColors;
    const { error } = await updateSetting({
      key: "application-colors",
      value: _.isEmpty(nextColors) ? null : nextColors,
    });
    if (!error) {
      applyColorSettings(nextColors);
    }
  };

  const saveColorsLater = useDebouncedCallback(saveColors, {
    delay: SAVE_DELAY_MS,
    flushOnUnmount: true,
  });

  const handleChange = (key: EditableColorKey, color: string) => {
    const nextColors = setApplicationColor(colors, key, color);
    setColors(nextColors);
    saveColorsLater(nextColors);
  };

  const handleReset = (key: EditableColorKey) => {
    const nextColors = resetApplicationColor(colors, key);
    setColors(nextColors);
    saveColorsLater(nextColors);
  };

  const handleResetAll = () => {
    saveColorsLater.cancel();
    setColors({});
    saveColors({});
  };

  const hasCustomColors = !_.isEmpty(colors);

  return (
    <Stack gap="xl" data-testid="application-colors-setting">
      <Box>
        <SettingHeader
          title={t`Interface colors`}
          description={t`Colors of the buttons, links and query builder. In dark mode, colors that are too dark to read are shown lighter.`}
        />
        <Stack gap="md">
          {getInterfaceColorOptions().map((option) => (
            <ColorField
              key={option.key}
              option={option}
              color={colors[option.key]}
              onChange={handleChange}
              onReset={handleReset}
            />
          ))}
        </Stack>
      </Box>
      <Box>
        <SettingHeader
          title={t`Chart colors`}
          description={t`Charts use these colors in this order. Lighter and darker versions are derived from each color.`}
        />
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" verticalSpacing="md">
          {getChartColorOptions().map((option) => (
            <ColorField
              key={option.key}
              option={option}
              color={colors[option.key]}
              onChange={handleChange}
              onReset={handleReset}
            />
          ))}
        </SimpleGrid>
      </Box>
      {hasCustomColors && (
        <Group>
          <Button
            variant="subtle"
            leftSection={<Icon name="revert" aria-hidden />}
            onClick={handleResetAll}
          >
            {t`Reset all colors to default`}
          </Button>
        </Group>
      )}
    </Stack>
  );
}

interface ColorFieldProps {
  option: ColorOption;
  /** The saved color, or `undefined` when the default color is used. */
  color: string | undefined;
  onChange: (key: EditableColorKey, color: string) => void;
  onReset: (key: EditableColorKey) => void;
}

function ColorField({ option, color, onChange, onReset }: ColorFieldProps) {
  const [isPickerOpen, { open: openPicker, close: closePicker }] =
    useDisclosure(false);
  const { key, label, description, defaultColor } = option;
  const displayedColor = color ?? defaultColor;
  const isCustom = color !== undefined;
  const resetLabel = t`Reset ${label} to default`;

  const handleChange = (newColor?: string) => {
    if (newColor) {
      onChange(key, newColor);
    }
  };

  return (
    <Group gap="sm" wrap="nowrap" align="center" data-testid={`${key}-color`}>
      <Popover
        opened={isPickerOpen}
        onDismiss={closePicker}
        position="bottom-start"
      >
        <Popover.Target>
          <Box>
            <ColorPill
              color={displayedColor}
              aria-label={t`Pick ${label}`}
              onClick={openPicker}
            />
          </Box>
        </Popover.Target>
        <Popover.Dropdown>
          <ColorPickerContent value={displayedColor} onChange={handleChange} />
        </Popover.Dropdown>
      </Popover>
      <Box w="7rem" flex="none">
        <ColorInput
          aria-label={label}
          value={displayedColor}
          onChange={handleChange}
        />
      </Box>
      <Box flex={1} miw={0}>
        <Text fw="bold" lh="sm">
          {label}
        </Text>
        {description && (
          <Text c="text-secondary" size="sm" lh="sm">
            {description}
          </Text>
        )}
      </Box>
      {isCustom && (
        <Tooltip label={resetLabel}>
          <ActionIcon
            variant="subtle"
            aria-label={resetLabel}
            onClick={() => onReset(key)}
          >
            <Icon name="revert" aria-hidden />
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  );
}
