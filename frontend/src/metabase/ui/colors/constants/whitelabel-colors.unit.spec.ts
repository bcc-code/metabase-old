import Color from "color";

import {
  adaptWhitelabelTokensToDarkScheme,
  mapWhitelabelColorsToTokens,
} from "./whitelabel-colors";

describe("mapWhitelabelColorsToTokens", () => {
  it("translates whitelabel setting keys to their tokens", () => {
    expect(
      mapWhitelabelColorsToTokens({
        brand: "#ff0000",
        filter: "#00ff00",
        summarize: "#0000ff",
        accent0: "#111111",
      }),
    ).toEqual({
      "core-brand": "#ff0000",
      "core-filter": "#00ff00",
      "core-summarize": "#0000ff",
      accent0: "#111111",
    });
  });
});

describe("adaptWhitelabelTokensToDarkScheme", () => {
  const darkBackground = "hsla(204, 53%, 10%, 1)";

  const getContrast = (color: string | undefined) =>
    Color(color).contrast(Color(darkBackground));

  it("lightens brand, filter and summarize colors that are hard to read on the background", () => {
    const adapted = adaptWhitelabelTokensToDarkScheme(
      {
        "core-brand": "#004D48",
        "core-filter": "#49706D",
        "core-summarize": "#A86649",
      },
      darkBackground,
    );

    expect(getContrast(adapted["core-brand"])).toBeGreaterThanOrEqual(4.5);
    expect(getContrast(adapted["core-filter"])).toBeGreaterThanOrEqual(4.5);
    expect(getContrast(adapted["core-summarize"])).toBeGreaterThanOrEqual(4.5);
    expect(Color(adapted["core-brand"]).lightness()).toBeGreaterThan(
      Color("#004D48").lightness(),
    );
  });

  it("keeps the hue of a lightened color", () => {
    const adapted = adaptWhitelabelTokensToDarkScheme(
      { "core-brand": "#004D48" },
      darkBackground,
    );

    expect(Color(adapted["core-brand"]).hue()).toBeCloseTo(
      Color("#004D48").hue(),
      0,
    );
  });

  it("keeps colors that are already readable, and chart colors", () => {
    const tokens = {
      "core-brand": "#509EE3",
      accent0: "#004D48",
    };

    expect(adaptWhitelabelTokensToDarkScheme(tokens, darkBackground)).toEqual(
      tokens,
    );
  });

  it("keeps colors it cannot parse", () => {
    expect(
      adaptWhitelabelTokensToDarkScheme(
        { "core-brand": "not a color" },
        darkBackground,
      ),
    ).toEqual({ "core-brand": "not a color" });
  });
});
