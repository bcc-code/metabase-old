import Color from "color";

import type {
  ColorSettings,
  ColorSettingsAccentKey,
  ColorSettingsKey,
} from "metabase-types/api/settings";

import type { ColorPalette } from "../types";
import type { MetabaseColorKey } from "../types/color-keys";

/**
 * The admin appearance form and the `application-colors` setting keep addressing
 * these three colors by their older names (see GDGT-2517), so whitelabel values arrive
 * keyed by `brand`/`filter`/`summarize` and have to be translated to the token
 * names the app actually reads.
 *
 * The SDK v1 theme keeps the same public names but is translated separately, by
 * `SDK_TO_MAIN_APP_COLORS_MAPPING`.
 */
export const WHITELABEL_KEY_TO_COLOR_KEY = {
  brand: "core-brand",
  filter: "core-filter",
  summarize: "core-summarize",
} as const satisfies Partial<Record<ColorSettingsKey, MetabaseColorKey>>;

export type WhitelabelSettingKey = keyof typeof WHITELABEL_KEY_TO_COLOR_KEY;

export type WhitelabelColorKey =
  (typeof WHITELABEL_KEY_TO_COLOR_KEY)[WhitelabelSettingKey];

export const WHITELABEL_ACCENT_KEYS = [
  "accent0",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "accent7",
] as const satisfies readonly ColorSettingsAccentKey[];

const WHITELABEL_SETTING_KEYS: WhitelabelSettingKey[] = [
  "brand",
  "filter",
  "summarize",
];

export function mapWhitelabelColorsToTokens(
  colors: ColorSettings | null | undefined,
): ColorPalette {
  if (!colors) {
    return {};
  }

  const { brand, filter, summarize, ...accents } = colors;
  const tokens: ColorPalette = { ...accents };

  for (const settingKey of WHITELABEL_SETTING_KEYS) {
    const value = colors[settingKey];
    if (value !== undefined) {
      tokens[WHITELABEL_KEY_TO_COLOR_KEY[settingKey]] = value;
    }
  }

  return tokens;
}

/**
 * The whitelabel tokens that the dark color scheme also uses as text and icon
 * colors on the page background.
 */
const DARK_SCHEME_READABLE_KEYS = [
  "core-brand",
  "core-filter",
  "core-summarize",
] as const satisfies readonly WhitelabelColorKey[];

const MIN_TEXT_CONTRAST_RATIO = 4.5;
const LIGHTNESS_STEP = 2;
const MAX_LIGHTNESS = 100;

/**
 * Adapts whitelabel tokens to the dark color scheme. A brand, filter or
 * summarize color that is too dark to read on `background` is lightened until
 * it reaches a 4.5:1 contrast ratio, so a dark brand color picked for the light
 * scheme stays legible. Other tokens, and colors that cannot be parsed, are
 * returned unchanged.
 */
export function adaptWhitelabelTokensToDarkScheme(
  tokens: ColorPalette,
  background: string,
): ColorPalette {
  const adapted: ColorPalette = { ...tokens };

  for (const key of DARK_SCHEME_READABLE_KEYS) {
    const value = tokens[key];
    if (value !== undefined) {
      adapted[key] = getReadableColor(value, background);
    }
  }

  return adapted;
}

function getReadableColor(value: string, background: string): string {
  try {
    const backgroundColor = Color(background);
    let color = Color(value);

    if (color.contrast(backgroundColor) >= MIN_TEXT_CONTRAST_RATIO) {
      return value;
    }

    while (
      color.contrast(backgroundColor) < MIN_TEXT_CONTRAST_RATIO &&
      color.lightness() < MAX_LIGHTNESS
    ) {
      color = color.lightness(
        Math.min(MAX_LIGHTNESS, color.lightness() + LIGHTNESS_STEP),
      );
    }

    return color.hex();
  } catch {
    return value;
  }
}
