import Color from "color";

import { PREDEFINED_FONT_FAMILIES_FALLBACK_MAP } from "metabase/utils/fonts";

import { BCC_THEME_COLORS, BCC_THEME_FONT } from "./bcc-theme";

const WHITE = Color("#ffffff");

describe("BCC theme", () => {
  it("uses BCC green from the BCC Design System as the primary color", () => {
    expect(BCC_THEME_COLORS.brand).toBe("#014D49");
  });

  it("uses the design system's categorical hues as chart colors, starting with BCC green", () => {
    expect([
      BCC_THEME_COLORS.accent0,
      BCC_THEME_COLORS.accent1,
      BCC_THEME_COLORS.accent2,
      BCC_THEME_COLORS.accent3,
      BCC_THEME_COLORS.accent4,
      BCC_THEME_COLORS.accent5,
      BCC_THEME_COLORS.accent6,
      BCC_THEME_COLORS.accent7,
    ]).toEqual([
      "#1D7F78",
      "#9A82DA",
      "#DA772E",
      "#1A9EB7",
      "#DE66B0",
      "#A98C66",
      "#608EF6",
      "#BC870D",
    ]);
  });

  it.each(["brand", "filter", "summarize"] as const)(
    "keeps the %s color readable as text on white",
    (key) => {
      expect(
        Color(BCC_THEME_COLORS[key]).contrast(WHITE),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("uses Archivo, which this fork bundles", () => {
    expect(BCC_THEME_FONT).toBe("Archivo");
    expect(Object.keys(PREDEFINED_FONT_FAMILIES_FALLBACK_MAP)).toContain(
      BCC_THEME_FONT,
    );
  });
});
