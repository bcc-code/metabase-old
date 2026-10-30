import {
  formatFileSize,
  getImageAcceptAttribute,
  readImageFile,
} from "./images";

const PNG_BYTES = "png bytes";

describe("readImageFile", () => {
  it("reads an image into a base64 data URI", async () => {
    const file = new File([PNG_BYTES], "logo.png", { type: "image/png" });

    expect(
      await readImageFile(file, { formats: ["png"], maxSizeBytes: 1024 }),
    ).toEqual({
      type: "success",
      dataUri: `data:image/png;base64,${btoa(PNG_BYTES)}`,
    });
  });

  it("uses the media type of the file extension when the browser reports none", async () => {
    const file = new File(["icon"], "favicon.ico", { type: "" });

    const result = await readImageFile(file, {
      formats: ["ico"],
      maxSizeBytes: 1024,
    });

    expect(result).toEqual({
      type: "success",
      dataUri: `data:image/x-icon;base64,${btoa("icon")}`,
    });
  });

  it("rejects other formats", async () => {
    const file = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });

    expect(
      await readImageFile(file, {
        formats: ["png", "jpeg"],
        maxSizeBytes: 1024,
      }),
    ).toEqual({
      type: "error",
      message: "Choose an image in one of these formats: PNG, JPEG.",
    });
  });

  it("rejects files that are too large", async () => {
    const file = new File(["x".repeat(2048)], "logo.png", {
      type: "image/png",
    });

    expect(
      await readImageFile(file, { formats: ["png"], maxSizeBytes: 1024 }),
    ).toEqual({
      type: "error",
      message: "This image is too large. Choose one smaller than 1 KB.",
    });
  });
});

describe("formatFileSize", () => {
  it("formats kilobytes and megabytes", () => {
    expect(formatFileSize(256 * 1024)).toBe("256 KB");
    expect(formatFileSize(2 * 1024 * 1024)).toBe("2 MB");
  });
});

describe("getImageAcceptAttribute", () => {
  it("lists every file extension of the formats", () => {
    expect(getImageAcceptAttribute(["jpeg", "ico"])).toBe(".jpg,.jpeg,.ico");
  });
});
