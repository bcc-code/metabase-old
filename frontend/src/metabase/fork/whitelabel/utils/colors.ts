import type { ColorSettings } from "metabase-types/api";

export const INTERFACE_COLOR_KEYS = ["brand", "filter", "summarize"] as const;

export const CHART_COLOR_KEYS = [
  "accent0",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "accent7",
] as const;

export type InterfaceColorKey = (typeof INTERFACE_COLOR_KEYS)[number];
export type ChartColorKey = (typeof CHART_COLOR_KEYS)[number];
export type EditableColorKey = InterfaceColorKey | ChartColorKey;

const isChartColorKey = (key: EditableColorKey): key is ChartColorKey =>
  CHART_COLOR_KEYS.some((chartKey) => chartKey === key);

// A saved light or dark variant belongs to the chart color it was picked for,
// so it is dropped whenever that color changes and derived again from the new one.
const withoutChartColorVariants = (
  colors: ColorSettings,
  key: EditableColorKey,
): ColorSettings => {
  const next: ColorSettings = { ...colors };
  if (isChartColorKey(key)) {
    delete next[`${key}-light`];
    delete next[`${key}-dark`];
  }
  return next;
};

/**
 * Returns `colors` with `key` set to `value`. Setting a chart color drops the
 * light and dark variants saved for it.
 */
export const setApplicationColor = (
  colors: ColorSettings,
  key: EditableColorKey,
  value: string,
): ColorSettings => ({
  ...withoutChartColorVariants(colors, key),
  [key]: value,
});

/**
 * Returns `colors` without `key`, so the default color is used again. Resetting
 * a chart color also drops the light and dark variants saved for it.
 */
export const resetApplicationColor = (
  colors: ColorSettings,
  key: EditableColorKey,
): ColorSettings => {
  const next = withoutChartColorVariants(colors, key);
  delete next[key];
  return next;
};
