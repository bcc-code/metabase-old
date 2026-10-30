import userEvent from "@testing-library/user-event";

import {
  findRequests,
  setupPropertiesEndpoints,
  setupSettingsEndpoints,
  setupUpdateSettingEndpoint,
} from "__support__/server-mocks";
import { createMockSettingsState } from "__support__/state";
import { renderWithProviders, screen, waitFor } from "__support__/ui";
import { createMockSettings } from "metabase-types/api/mocks";

import { LandingPageUrlInput } from "./LandingPageUrlInput";

interface SetupOpts {
  landingPage?: string;
  updateStatus?: number;
}

function setup({ landingPage = "", updateStatus = 204 }: SetupOpts = {}) {
  const settings = createMockSettings({ "landing-page": landingPage });
  setupPropertiesEndpoints(settings);
  setupSettingsEndpoints([]);
  setupUpdateSettingEndpoint(
    updateStatus === 204
      ? { status: 204 }
      : { status: updateStatus, body: "This field must be a relative URL." },
  );

  renderWithProviders(<LandingPageUrlInput />, {
    storeInitialState: { settings: createMockSettingsState(settings) },
  });
}

describe("LandingPageUrlInput", () => {
  it("saves the landing page when the input loses focus", async () => {
    setup({ landingPage: "/dashboard/1" });

    const input = screen.getByRole("textbox", { name: "Custom homepage URL" });
    expect(input).toHaveValue("/dashboard/1");
    await userEvent.clear(input);
    await userEvent.type(input, "/collection/2");
    await userEvent.tab();

    await waitFor(async () => {
      const puts = await findRequests("PUT");
      expect(puts.map(({ body }) => body)).toEqual([
        { value: "/collection/2" },
      ]);
    });
  });

  it("doesn't save an unchanged landing page", async () => {
    setup({ landingPage: "/dashboard/1" });

    await userEvent.click(
      screen.getByRole("textbox", { name: "Custom homepage URL" }),
    );
    await userEvent.tab();

    expect(await findRequests("PUT")).toHaveLength(0);
  });

  it("shows why the landing page could not be saved", async () => {
    setup({ updateStatus: 400 });

    await userEvent.type(
      screen.getByRole("textbox", { name: "Custom homepage URL" }),
      "https://example.com",
    );
    await userEvent.tab();

    expect(
      await screen.findByText("This field must be a relative URL."),
    ).toBeInTheDocument();
  });
});
