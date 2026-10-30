import { mockSettings } from "__support__/settings";
import { createMockState } from "__support__/state";
import { renderWithProviders, screen } from "__support__/ui";
import type { EnterpriseSettings } from "metabase-types/api";

import { WhitelabelLogoIcon } from "./WhitelabelLogoIcon";

const LOGO_DATA_URI = `data:image/png;base64,${btoa("logo")}`;

function setup(settings: Partial<EnterpriseSettings>) {
  renderWithProviders(<WhitelabelLogoIcon height={48} />, {
    storeInitialState: createMockState({ settings: mockSettings(settings) }),
  });
}

describe("WhitelabelLogoIcon", () => {
  it("shows the default logo when no logo is uploaded", () => {
    setup({ "application-logo-url": "app/assets/img/logo.svg" });

    const logo = screen.getByTestId("main-logo");
    expect(logo.tagName).toBe("svg");
  });

  it("shows the uploaded logo, named after the application", () => {
    setup({
      "application-logo-url": LOGO_DATA_URI,
      "application-name": "BCC Insights",
    });

    const logo = screen.getByRole("img", { name: "BCC Insights logo" });
    expect(logo).toHaveAttribute("src", LOGO_DATA_URI);
    expect(logo).toHaveAttribute("data-testid", "main-logo");
  });
});
