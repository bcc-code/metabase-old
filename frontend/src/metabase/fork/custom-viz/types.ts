/**
 * The custom visualization plugin contract, version 1. README.md in this
 * folder documents it for plugin authors; keep the two in sync.
 */
import type { RowValue } from "metabase-types/api";

export const CUSTOM_VIZ_API_VERSION = 1;

export type CustomVizApiVersion = typeof CUSTOM_VIZ_API_VERSION;

export const CUSTOM_VIZ_REQUIRED_COLUMN_TYPES = [
  "number",
  "string",
  "date",
  "boolean",
] as const;

export type CustomVizRequiredColumnType =
  (typeof CUSTOM_VIZ_REQUIRED_COLUMN_TYPES)[number];

export const CUSTOM_VIZ_COLUMN_TYPES = [
  "any",
  ...CUSTOM_VIZ_REQUIRED_COLUMN_TYPES,
] as const;

export type CustomVizColumnType = (typeof CUSTOM_VIZ_COLUMN_TYPES)[number];

export type CustomVizSelectValue = string | number | boolean;

export type CustomVizSelectOption = {
  name: string;
  value: CustomVizSelectValue;
};

type CustomVizSettingBase = {
  id: string;
  title: string;
  section?: string;
};

export type CustomVizSettingDefinition =
  | (CustomVizSettingBase & {
      type: "text";
      default?: string;
      placeholder?: string;
    })
  | (CustomVizSettingBase & {
      type: "number";
      default?: number;
      placeholder?: string;
    })
  | (CustomVizSettingBase & {
      type: "select";
      options: CustomVizSelectOption[];
      default?: CustomVizSelectValue;
    })
  | (CustomVizSettingBase & { type: "toggle"; default?: boolean })
  | (CustomVizSettingBase & { type: "color"; default?: string })
  | (CustomVizSettingBase & {
      type: "column" | "columns";
      columnType?: CustomVizColumnType;
    });

export type CustomVizSettingType = CustomVizSettingDefinition["type"];

export type CustomVizDataRequirements = {
  minRows?: number;
  maxRows?: number;
  minColumns?: number;
  maxColumns?: number;
  requiredColumnTypes?: Partial<Record<CustomVizRequiredColumnType, number>>;
};

export type CustomVizManifest = {
  apiVersion: CustomVizApiVersion;
  identifier: string;
  name: string;
  icon?: string;
  description?: string;
  data?: CustomVizDataRequirements;
  settings?: CustomVizSettingDefinition[];
};

/** A query result column, as a plugin sees it. */
export type CustomVizColumn = {
  name: string;
  displayName: string;
  type: CustomVizRequiredColumnType | "other";
  baseType: string;
  semanticType: string | null;
};

export type CustomVizTheme = {
  colorScheme: "light" | "dark";
  fontFamily: string;
  colors: {
    brand: string;
    textPrimary: string;
    textSecondary: string;
    background: string;
    border: string;
    accents: string[];
  };
};

export type CustomVizClickEvent = {
  rowIndex: number;
  columnName: string;
  event?: MouseEvent;
  element?: Element;
};

export type CustomVizRenderProps = {
  apiVersion: CustomVizApiVersion;
  data: {
    cols: CustomVizColumn[];
    rows: readonly (readonly RowValue[])[];
  };
  settings: Record<string, unknown>;
  width: number;
  height: number;
  theme: CustomVizTheme;
  isDashboard: boolean;
  isEditing: boolean;
  formatValue: (value: unknown, columnName: string) => string;
  /** `null` where clicks lead nowhere, e.g. in a visualization preview. */
  onClick: ((event: CustomVizClickEvent) => void) | null;
};

/** What a plugin's `mount` may return; both methods are optional. */
export type CustomVizMountHandle = {
  update?: (props: CustomVizRenderProps) => void;
  unmount?: () => void;
};

/** A plugin's definition after the host has checked its shape. */
export type CustomVizDefinition = {
  mount: (
    container: HTMLElement,
    props: CustomVizRenderProps,
  ) => CustomVizMountHandle;
};

/** The global `window.MetabaseCustomViz` that bundles call. */
export type CustomVizHostApi = {
  apiVersion: CustomVizApiVersion;
  define: (identifier: unknown, definition: unknown) => void;
};
