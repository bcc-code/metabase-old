import { t } from "ttag";

import { isObject } from "metabase-types/guards";

import {
  CUSTOM_VIZ_API_VERSION,
  CUSTOM_VIZ_COLUMN_TYPES,
  CUSTOM_VIZ_REQUIRED_COLUMN_TYPES,
  type CustomVizColumnType,
  type CustomVizDataRequirements,
  type CustomVizManifest,
  type CustomVizSelectOption,
  type CustomVizSelectValue,
  type CustomVizSettingDefinition,
} from "./types";

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const SETTING_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/**
 * The manifest of a custom visualization, checked against contract version 1.
 * The server validates manifests on upload; this keeps the browser from
 * trusting a value it only knows as JSON. Throws an `Error` saying what is
 * wrong.
 */
export function parseCustomVizManifest(value: unknown): CustomVizManifest {
  if (!isObject(value)) {
    throw new Error(t`The manifest is missing.`);
  }
  if (value.apiVersion !== CUSTOM_VIZ_API_VERSION) {
    throw new Error(
      t`The bundle needs custom visualization API version ${String(value.apiVersion)}, but only version ${CUSTOM_VIZ_API_VERSION} is supported.`,
    );
  }
  const { identifier, name } = value;
  if (typeof identifier !== "string" || !IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(t`The manifest has an invalid identifier.`);
  }
  if (!isNonBlankString(name)) {
    throw new Error(t`The manifest needs a name.`);
  }

  return {
    apiVersion: CUSTOM_VIZ_API_VERSION,
    identifier,
    name,
    icon: optionalString(value.icon),
    description: optionalString(value.description),
    data: parseDataRequirements(value.data),
    settings: parseSettings(value.settings),
  };
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function isSelectValue(value: unknown): value is CustomVizSelectValue {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isColumnType(value: unknown): value is CustomVizColumnType {
  return CUSTOM_VIZ_COLUMN_TYPES.some((columnType) => columnType === value);
}

function parseDataRequirements(
  value: unknown,
): CustomVizDataRequirements | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  const requiredColumnTypes = isObject(value.requiredColumnTypes)
    ? value.requiredColumnTypes
    : {};

  return {
    minRows: optionalCount(value.minRows),
    maxRows: optionalCount(value.maxRows),
    minColumns: optionalCount(value.minColumns),
    maxColumns: optionalCount(value.maxColumns),
    requiredColumnTypes: Object.fromEntries(
      CUSTOM_VIZ_REQUIRED_COLUMN_TYPES.flatMap((columnType) => {
        const count = optionalCount(requiredColumnTypes[columnType]);
        return count ? [[columnType, count]] : [];
      }),
    ),
  };
}

function parseSettings(
  value: unknown,
): CustomVizSettingDefinition[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(t`The manifest's settings must be a list.`);
  }
  return value.map(parseSetting);
}

function parseSelectOptions(value: unknown): CustomVizSelectOption[] {
  const options = Array.isArray(value) ? value : [];
  const parsedOptions = options.flatMap((option: unknown) =>
    isObject(option) &&
    isNonBlankString(option.name) &&
    isSelectValue(option.value)
      ? [{ name: option.name, value: option.value }]
      : [],
  );
  if (parsedOptions.length === 0 || parsedOptions.length !== options.length) {
    throw new Error(t`A select setting needs a list of options.`);
  }
  return parsedOptions;
}

function parseSetting(value: unknown): CustomVizSettingDefinition {
  if (!isObject(value)) {
    throw new Error(t`Each setting must be an object.`);
  }
  const { id, title, type } = value;
  if (typeof id !== "string" || !SETTING_ID_PATTERN.test(id)) {
    throw new Error(t`A setting has an invalid id.`);
  }
  if (!isNonBlankString(title)) {
    throw new Error(t`The setting "${id}" needs a title.`);
  }
  const base = { id, title, section: optionalString(value.section) };
  const defaultValue = value.default;

  switch (type) {
    case "text":
      return {
        ...base,
        type,
        default: optionalString(defaultValue),
        placeholder: optionalString(value.placeholder),
      };
    case "number":
      return {
        ...base,
        type,
        default: typeof defaultValue === "number" ? defaultValue : undefined,
        placeholder: optionalString(value.placeholder),
      };
    case "select":
      return {
        ...base,
        type,
        options: parseSelectOptions(value.options),
        default: isSelectValue(defaultValue) ? defaultValue : undefined,
      };
    case "toggle":
      return {
        ...base,
        type,
        default: typeof defaultValue === "boolean" ? defaultValue : undefined,
      };
    case "color":
      return { ...base, type, default: optionalString(defaultValue) };
    case "column":
    case "columns":
      return {
        ...base,
        type,
        columnType: isColumnType(value.columnType) ? value.columnType : "any",
      };
    default:
      throw new Error(
        t`The setting "${id}" has an unknown type: ${String(type)}.`,
      );
  }
}
