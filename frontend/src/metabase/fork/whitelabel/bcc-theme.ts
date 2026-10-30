/* eslint-disable metabase/no-color-literals -- BCC's brand palette is data that admins save into the application-colors setting */
import type { ColorSettings } from "metabase-types/api";

// Values are tokens from the BCC Design System (the organization's design system for its digital products).
// BCC green, `--color-bcc-800`: the brand color.
const BCC_GREEN = "#014D49";
// `--color-bcc-600`: BCC green light enough to chart next to the other hues.
const BCC_GREEN_600 = "#1D7F78";
// The 700 steps of two accent hues, dark enough for white text, for the query builder's filter and summarize steps.
const PURPLE_700 = "#61479C";
const ORANGE_700 = "#943A14";
// The 500 steps of the accent hues the design system reserves for categorisation. Red, green and yellow carry
// fixed meanings there (danger, success, warning), so they come last or not at all.
const PURPLE_500 = "#9A82DA";
const ORANGE_500 = "#DA772E";
const TEAL_500 = "#1A9EB7";
const MAGENTA_500 = "#DE66B0";
const BROWN_500 = "#A98C66";
const BLUE_500 = "#608EF6";
const YELLOW_500 = "#BC870D";

/**
 * BCC's brand palette as an `application-colors` value. The interface colors
 * keep at least a 4.5:1 contrast ratio with white; the chart colors are the
 * design system's categorical hues.
 */
export const BCC_THEME_COLORS = {
  brand: BCC_GREEN,
  filter: PURPLE_700,
  summarize: ORANGE_700,
  accent0: BCC_GREEN_600,
  accent1: PURPLE_500,
  accent2: ORANGE_500,
  accent3: TEAL_500,
  accent4: MAGENTA_500,
  accent5: BROWN_500,
  accent6: BLUE_500,
  accent7: YELLOW_500,
} as const satisfies ColorSettings;

/** Archivo, the BCC Design System's typeface, bundled with this fork. */
export const BCC_THEME_FONT = "Archivo";

/** The colors to preview the BCC theme with: the brand color, then the chart colors in order. */
export const BCC_THEME_SWATCHES: readonly string[] = [
  BCC_GREEN,
  BCC_GREEN_600,
  PURPLE_500,
  ORANGE_500,
  TEAL_500,
  MAGENTA_500,
  BROWN_500,
  BLUE_500,
  YELLOW_500,
];
