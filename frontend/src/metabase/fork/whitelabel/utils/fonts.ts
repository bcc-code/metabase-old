import type { FontFile, FontFormat } from "metabase-types/api";

import { CUSTOM_FONT_WEIGHTS, type CustomFontWeight } from "../constants";

const FONT_FORMATS_BY_EXTENSION: Record<string, FontFormat> = {
  woff2: "woff2",
  woff: "woff",
  ttf: "truetype",
};

/**
 * The CSS font format of a font file URL, from its file extension, or
 * `undefined` for a file type that browsers can't load as a web font.
 */
export const getFontFormat = (url: string): FontFormat | undefined => {
  const [path = ""] = url.split(/[?#]/);
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return Object.hasOwn(FONT_FORMATS_BY_EXTENSION, extension)
    ? FONT_FORMATS_BY_EXTENSION[extension]
    : undefined;
};

/** Whether `url` is an absolute `http:` or `https:` URL. */
export const isHttpUrl = (url: string): boolean => {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

export type FontUrlError = "invalid-url" | "unsupported-format";

/** Why `url` can't be used as a custom font file, or `null` when it can. */
export const getFontUrlError = (url: string): FontUrlError | null => {
  if (!isHttpUrl(url)) {
    return "invalid-url";
  }
  if (getFontFormat(url) === undefined) {
    return "unsupported-format";
  }
  return null;
};

export type CustomFontUrls = Partial<Record<CustomFontWeight, string>>;

/**
 * The `application-font-files` value for the given URL of each font weight.
 * Blank URLs and URLs of unsupported font files are left out.
 */
export const getFontFiles = (urls: CustomFontUrls): FontFile[] =>
  CUSTOM_FONT_WEIGHTS.flatMap((fontWeight) => {
    const src = urls[fontWeight]?.trim() ?? "";
    const fontFormat = getFontFormat(src);
    return src && fontFormat ? [{ src, fontFormat, fontWeight }] : [];
  });

/** The URL of each font weight in an `application-font-files` value. */
export const getCustomFontUrls = (
  fontFiles: FontFile[] | null | undefined,
): CustomFontUrls =>
  Object.fromEntries(
    CUSTOM_FONT_WEIGHTS.flatMap((fontWeight) => {
      const file = fontFiles?.find((file) => file.fontWeight === fontWeight);
      return file ? [[fontWeight, file.src]] : [];
    }),
  );
