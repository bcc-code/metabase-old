import { t } from "ttag";

import type { LoadingMessage } from "metabase-types/api";

export const DEFAULT_LOGO_URL = "app/assets/img/logo.svg";
export const DEFAULT_FAVICON_URL = "app/assets/img/favicon.ico";

/**
 * Fonts the `application-font` setting accepts besides the bundled ones, read
 * from the viewer's system. Keep in sync with
 * `metabase.appearance.settings/web-safe-fonts`.
 */
export const WEB_SAFE_FONTS = [
  "Arial",
  "Georgia",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
] as const;

/**
 * The font weights an admin can give a custom font file for, in the order the
 * branding page lists them.
 */
export const CUSTOM_FONT_WEIGHTS = [400, 700, 900] as const;

export type CustomFontWeight = (typeof CUSTOM_FONT_WEIGHTS)[number];

export const getCustomFontWeightLabel = (weight: CustomFontWeight): string => {
  switch (weight) {
    case 400:
      return t`Regular`;
    case 700:
      return t`Bold`;
    case 900:
      return t`Heavy`;
  }
};

const LOADING_MESSAGES: LoadingMessage[] = [
  "doing-science",
  "running-query",
  "loading-results",
];

/**
 * The text shown while a query runs, for each `loading-message` value.
 * `isSlow` is true once the query has been running for a while.
 */
export const getLoadingMessageText = (
  loadingMessage: LoadingMessage,
  isSlow = false,
): string => {
  switch (loadingMessage) {
    case "doing-science":
      return isSlow ? t`Waiting for results...` : t`Doing science...`;
    case "running-query":
      return t`Running query...`;
    case "loading-results":
      return t`Loading results...`;
  }
};

export const getLoadingMessageOptions = () =>
  LOADING_MESSAGES.map((value) => ({
    value,
    label: getLoadingMessageText(value),
  }));

const KILOBYTE = 1024;
const MEGABYTE = 1024 * KILOBYTE;

export const LOGO_MAX_SIZE_BYTES = 512 * KILOBYTE;
export const FAVICON_MAX_SIZE_BYTES = 256 * KILOBYTE;
export const ILLUSTRATION_MAX_SIZE_BYTES = 2 * MEGABYTE;
