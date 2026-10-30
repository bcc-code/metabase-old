import {
  getCustomFontUrls,
  getFontFiles,
  getFontFormat,
  getFontUrlError,
} from "./fonts";

describe("getFontFormat", () => {
  it.each([
    ["https://example.com/font.woff2", "woff2"],
    ["https://example.com/font.WOFF", "woff"],
    ["https://example.com/font.ttf?v=2#top", "truetype"],
    ["https://example.com/font.otf", undefined],
    ["https://example.com/font", undefined],
  ])("%s is %s", (url, format) => {
    expect(getFontFormat(url)).toBe(format);
  });
});

describe("getFontUrlError", () => {
  it("accepts absolute web font URLs", () => {
    expect(getFontUrlError("https://example.com/font.woff2")).toBeNull();
  });

  it("rejects relative URLs and other protocols", () => {
    expect(getFontUrlError("/fonts/font.woff2")).toBe("invalid-url");
    expect(getFontUrlError("javascript:alert(1).woff2")).toBe("invalid-url");
  });

  it("rejects files that aren't web fonts", () => {
    expect(getFontUrlError("https://example.com/font.otf")).toBe(
      "unsupported-format",
    );
  });
});

describe("getFontFiles", () => {
  it("builds the font files of the weights with a URL", () => {
    expect(
      getFontFiles({
        400: " https://example.com/regular.woff2 ",
        700: "",
        900: "https://example.com/heavy.ttf",
      }),
    ).toEqual([
      {
        src: "https://example.com/regular.woff2",
        fontFormat: "woff2",
        fontWeight: 400,
      },
      {
        src: "https://example.com/heavy.ttf",
        fontFormat: "truetype",
        fontWeight: 900,
      },
    ]);
  });

  it("reads the URLs back", () => {
    const urls = { 400: "https://example.com/regular.woff2" };
    expect(getCustomFontUrls(getFontFiles(urls))).toEqual(urls);
    expect(getCustomFontUrls(null)).toEqual({});
  });
});
