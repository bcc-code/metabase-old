import { match } from "ts-pattern";
import { t } from "ttag";

import { color } from "metabase/ui/colors";
import {
  type ComputedVisualizationSettings,
  type VisualizationSettingDefinition,
  type VisualizationSettingsDefinitions,
  columnSettings,
  fieldSetting,
  getCustomVizSettingKeyPrefix,
} from "metabase/viz-core";
import {
  isBoolean,
  isDate,
  isNumeric,
  isString,
} from "metabase-lib/v1/types/utils/isa";
import type {
  CustomVizDisplayType,
  DatasetColumn,
  Series,
} from "metabase-types/api";

import type {
  CustomVizColumnType,
  CustomVizManifest,
  CustomVizSettingDefinition,
} from "../types";

const COLUMN_FILTERS: Record<
  CustomVizColumnType,
  (column: DatasetColumn) => boolean
> = {
  any: () => true,
  number: isNumeric,
  string: isString,
  date: isDate,
  boolean: isBoolean,
};

/** The key a plugin setting is stored under in `visualization_settings`. */
export function getCustomVizSettingKey(
  display: CustomVizDisplayType,
  settingId: string,
): string {
  return `${getCustomVizSettingKeyPrefix(display)}${settingId}`;
}

function getColumns(
  [{ data }]: Series,
  columnType: CustomVizColumnType = "any",
): DatasetColumn[] {
  return data.cols.filter(COLUMN_FILTERS[columnType]);
}

function getSettingDefinition(
  key: string,
  setting: CustomVizSettingDefinition,
): VisualizationSettingDefinition<Series> {
  const base = {
    title: setting.title,
    getSection: () => setting.section ?? t`Display`,
  };

  return match(setting)
    .with({ type: "text" }, (textSetting) => ({
      ...base,
      widget: "input",
      props: { placeholder: textSetting.placeholder ?? "" },
      getDefault: () => textSetting.default,
    }))
    .with({ type: "number" }, (numberSetting) => ({
      ...base,
      widget: "number",
      props: { placeholder: numberSetting.placeholder },
      getDefault: () => numberSetting.default,
    }))
    .with({ type: "select" }, (selectSetting) => ({
      ...base,
      widget: "select",
      props: { options: selectSetting.options },
      getDefault: () =>
        selectSetting.default ?? selectSetting.options[0]?.value,
    }))
    .with({ type: "toggle" }, (toggleSetting) => ({
      ...base,
      widget: "toggle",
      inline: true,
      getDefault: () => toggleSetting.default ?? false,
    }))
    .with({ type: "color" }, (colorSetting) => ({
      ...base,
      widget: "color",
      getDefault: () => colorSetting.default ?? color("accent0"),
    }))
    .with(
      { type: "column" },
      (columnSetting) =>
        fieldSetting(key, {
          ...base,
          fieldFilter: COLUMN_FILTERS[columnSetting.columnType ?? "any"],
        })[key],
    )
    .with({ type: "columns" }, (columnsSetting) => ({
      ...base,
      widget: "multiselect",
      getDefault: (series: Series) =>
        getColumns(series, columnsSetting.columnType).map(
          (column) => column.name,
        ),
      getProps: (series: Series) => ({
        options: getColumns(series, columnsSetting.columnType).map(
          (column) => ({ value: column.name, label: column.display_name }),
        ),
        placeholder: t`Choose columns`,
        placeholderNoOptions: t`There are no columns to choose from`,
      }),
      isValid: (series: Series, settings: ComputedVisualizationSettings) => {
        const value: unknown = settings[key];
        const columnNames = getColumns(series, columnsSetting.columnType).map(
          (column) => column.name,
        );
        return (
          Array.isArray(value) &&
          value.every(
            (name: unknown) =>
              typeof name === "string" && columnNames.includes(name),
          )
        );
      },
    }))
    .exhaustive();
}

/**
 * The visualization settings of a plugin, stored under
 * `custom:<identifier>:<setting id>`, plus the column formatting settings.
 */
export function getCustomVizSettingDefinitions(
  display: CustomVizDisplayType,
  manifest: CustomVizManifest,
): VisualizationSettingsDefinitions {
  const pluginSettings = Object.fromEntries(
    (manifest.settings ?? []).map((setting) => {
      const key = getCustomVizSettingKey(display, setting.id);
      return [key, getSettingDefinition(key, setting)];
    }),
  );
  return { ...pluginSettings, ...columnSettings() };
}

/** The plugin's own settings, by setting id, read from the computed settings. */
export function getCustomVizSettingValues(
  display: CustomVizDisplayType,
  manifest: CustomVizManifest,
  settings: ComputedVisualizationSettings,
): Record<string, unknown> {
  return Object.fromEntries(
    (manifest.settings ?? []).map((setting) => [
      setting.id,
      settings[getCustomVizSettingKey(display, setting.id)],
    ]),
  );
}
