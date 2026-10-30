import { mockSettings } from "__support__/settings";
import { createMockState } from "__support__/state";
import { renderWithProviders } from "__support__/ui";
import type { EnterpriseSettings } from "metabase-types/api";

import {
  getApplicationName,
  getIsWhiteLabeling,
  getLandingPageIllustration,
  getLoadingMessageFactory,
  getLoginPageIllustration,
  getNoDataIllustration,
  getNoObjectIllustration,
  getShowMetabaseLinks,
} from "./selectors";

const CUSTOM_IMAGE_URL =
  "api/session/illustration/login-page-illustration-custom?v=0123456789abcdef";

function setup(settings: Partial<EnterpriseSettings> = {}) {
  const {
    store: { getState },
  } = renderWithProviders(<></>, {
    storeInitialState: createMockState({ settings: mockSettings(settings) }),
  });

  return { state: getState() };
}

describe("whitelabel selectors", () => {
  describe("getApplicationName", () => {
    it("returns the application name", () => {
      const { state } = setup({ "application-name": "BCC Insights" });
      expect(getApplicationName(state)).toBe("BCC Insights");
      expect(getIsWhiteLabeling(state)).toBe(true);
    });

    it("falls back to the default name when the setting is blank", () => {
      const { state } = setup({ "application-name": "" });
      expect(getApplicationName(state)).toBe("Metabase");
      expect(getIsWhiteLabeling(state)).toBe(false);
    });
  });

  it("follows the show-metabase-links setting", () => {
    expect(
      getShowMetabaseLinks(setup({ "show-metabase-links": false }).state),
    ).toBe(false);
    expect(
      getShowMetabaseLinks(setup({ "show-metabase-links": true }).state),
    ).toBe(true);
  });

  describe("getLoadingMessageFactory", () => {
    it.each([
      ["doing-science", "Doing science...", "Waiting for results..."],
      ["running-query", "Running query...", "Running query..."],
      ["loading-results", "Loading results...", "Loading results..."],
    ] as const)(
      "uses the %s message",
      (loadingMessage, message, slowMessage) => {
        const { state } = setup({ "loading-message": loadingMessage });
        const getLoadingMessage = getLoadingMessageFactory(state);

        expect(getLoadingMessage()).toBe(message);
        expect(getLoadingMessage(true)).toBe(slowMessage);
      },
    );

    it("returns the same function for the same setting", () => {
      const { state } = setup({ "loading-message": "running-query" });
      expect(getLoadingMessageFactory(state)).toBe(
        getLoadingMessageFactory(state),
      );
    });
  });

  describe("page illustrations", () => {
    it("uses the default illustration by default", () => {
      const { state } = setup({ "login-page-illustration": "default" });
      expect(getLoginPageIllustration(state)).toEqual({
        src: expect.any(String),
        isDefault: true,
      });
    });

    it("hides the illustration", () => {
      const { state } = setup({
        "login-page-illustration": "none",
        "landing-page-illustration": "none",
      });
      expect(getLoginPageIllustration(state)).toBeNull();
      expect(getLandingPageIllustration(state)).toBeNull();
    });

    it("uses the uploaded illustration", () => {
      const { state } = setup({
        "login-page-illustration": "custom",
        "login-page-illustration-custom": CUSTOM_IMAGE_URL,
      });
      expect(getLoginPageIllustration(state)).toEqual({
        src: CUSTOM_IMAGE_URL,
        isDefault: false,
      });
      expect(getLoginPageIllustration(state)).toBe(
        getLoginPageIllustration(state),
      );
    });

    it("falls back to the default illustration when no image was uploaded", () => {
      const { state } = setup({
        "landing-page-illustration": "custom",
        "landing-page-illustration-custom": undefined,
      });
      expect(getLandingPageIllustration(state)).toMatchObject({
        isDefault: true,
      });
    });
  });

  describe("empty state illustrations", () => {
    it("uses the default, no or the uploaded illustration", () => {
      const defaultState = setup({ "no-data-illustration": "default" }).state;
      expect(getNoDataIllustration(defaultState)).toEqual(expect.any(String));

      const noneState = setup({ "no-object-illustration": "none" }).state;
      expect(getNoObjectIllustration(noneState)).toBeNull();

      const customState = setup({
        "no-data-illustration": "custom",
        "no-data-illustration-custom": "https://example.com/empty.png",
      }).state;
      expect(getNoDataIllustration(customState)).toBe(
        "https://example.com/empty.png",
      );
    });
  });
});
