import { t } from "ttag";

const IMAGE_FORMAT_NAMES = [
  "svg",
  "png",
  "jpeg",
  "gif",
  "webp",
  "ico",
] as const;

export type ImageFormat = (typeof IMAGE_FORMAT_NAMES)[number];

const IMAGE_FORMATS: Record<
  ImageFormat,
  { label: string; mimeTypes: readonly string[] }
> = {
  svg: { label: "SVG", mimeTypes: ["image/svg+xml"] },
  png: { label: "PNG", mimeTypes: ["image/png"] },
  jpeg: { label: "JPEG", mimeTypes: ["image/jpeg"] },
  gif: { label: "GIF", mimeTypes: ["image/gif"] },
  webp: { label: "WebP", mimeTypes: ["image/webp"] },
  ico: {
    label: "ICO",
    mimeTypes: ["image/x-icon", "image/vnd.microsoft.icon"],
  },
};

const FORMATS_BY_EXTENSION: Record<string, ImageFormat> = {
  svg: "svg",
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
  gif: "gif",
  webp: "webp",
  ico: "ico",
};

const KILOBYTE = 1024;
const MEGABYTE = 1024 * KILOBYTE;

export type ImageFileResult =
  | { type: "success"; dataUri: string }
  | { type: "error"; message: string };

const getImageFormat = (file: File): ImageFormat | undefined => {
  const formatFromType = IMAGE_FORMAT_NAMES.find((format) =>
    IMAGE_FORMATS[format].mimeTypes.includes(file.type),
  );
  if (formatFromType) {
    return formatFromType;
  }
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return Object.hasOwn(FORMATS_BY_EXTENSION, extension)
    ? FORMATS_BY_EXTENSION[extension]
    : undefined;
};

/** The `accept` attribute of a file input for images in the given formats. */
export const getImageAcceptAttribute = (
  formats: readonly ImageFormat[],
): string =>
  Object.entries(FORMATS_BY_EXTENSION)
    .filter(([, format]) => formats.includes(format))
    .map(([extension]) => `.${extension}`)
    .join(",");

/** A file size for people, like "256 KB" or "2 MB". */
export const formatFileSize = (sizeBytes: number): string =>
  sizeBytes >= MEGABYTE
    ? t`${Math.round(sizeBytes / MEGABYTE)} MB`
    : t`${Math.round(sizeBytes / KILOBYTE)} KB`;

/** "SVG, PNG or JPEG" style list of the given formats. */
export const formatImageFormats = (formats: readonly ImageFormat[]): string =>
  formats.map((format) => IMAGE_FORMATS[format].label).join(", ");

const readAsDataUri = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("The file could not be read as a data URI"));
      }
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("The file could not be read"));
    reader.readAsDataURL(file);
  });

/**
 * Reads an uploaded image into a base64 `data:` URI, as the appearance
 * settings store images. The URI's media type is the canonical one for the
 * image format, also when the browser reports none (as for some .ico files).
 * Resolves to an error message when the file has another format, is larger
 * than `maxSizeBytes`, or can't be read.
 */
export const readImageFile = async (
  file: File,
  {
    formats,
    maxSizeBytes,
  }: { formats: readonly ImageFormat[]; maxSizeBytes: number },
): Promise<ImageFileResult> => {
  const format = getImageFormat(file);
  if (format === undefined || !formats.includes(format)) {
    const formatList = formatImageFormats(formats);
    return {
      type: "error",
      message: t`Choose an image in one of these formats: ${formatList}.`,
    };
  }
  if (file.size > maxSizeBytes) {
    const maxSize = formatFileSize(maxSizeBytes);
    return {
      type: "error",
      message: t`This image is too large. Choose one smaller than ${maxSize}.`,
    };
  }

  try {
    const dataUri = await readAsDataUri(file);
    const [mimeType] = IMAGE_FORMATS[format].mimeTypes;
    return {
      type: "success",
      dataUri: dataUri.replace(/^data:[^;,]*/, `data:${mimeType}`),
    };
  } catch {
    return { type: "error", message: t`This file could not be read.` };
  }
};
