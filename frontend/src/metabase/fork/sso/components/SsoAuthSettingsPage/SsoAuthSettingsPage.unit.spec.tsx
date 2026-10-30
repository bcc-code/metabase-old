import userEvent from "@testing-library/user-event";

import {
  findRequests,
  setupApiKeyEndpoints,
  setupSettingsEndpoints,
  setupStatefulSettingsEndpoints,
} from "__support__/server-mocks";
import { renderWithProviders, screen, waitFor, within } from "__support__/ui";
import type { EnterpriseSettings } from "metabase-types/api";
import { createMockSettings } from "metabase-types/api/mocks";

import { SsoAuthSettingsPage } from "./SsoAuthSettingsPage";

interface SetupOpts {
  settingValues?: Partial<EnterpriseSettings>;
}

const setup = ({ settingValues = {} }: SetupOpts = {}) => {
  setupSettingsEndpoints([]);
  setupApiKeyEndpoints([]);
  setupStatefulSettingsEndpoints(
    createMockSettings({
      "google-auth-enabled": false,
      "google-auth-configured": false,
      "ldap-enabled": false,
      "ldap-configured?": false,
      "oidc-enabled": false,
      "oidc-configured": false,
      "jwt-enabled": false,
      "jwt-configured": false,
      "enable-password-login": true,
      "send-new-sso-user-admin-email?": true,
      ...settingValues,
    }),
  );

  renderWithProviders(<SsoAuthSettingsPage tab="authentication" />);
};

describe("SsoAuthSettingsPage", () => {
  it("lists OpenID Connect and JWT with the other sign-in methods, without upsells", async () => {
    setup();

    expect(await screen.findByText("OpenID Connect")).toBeInTheDocument();
    expect(screen.getByText("JWT")).toBeInTheDocument();
    expect(screen.getByText("Sign in with Google")).toBeInTheDocument();
    expect(screen.getByText("LDAP")).toBeInTheDocument();
    expect(screen.queryByText(/Pro/)).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("oidc-setting")).getByRole("link"),
    ).toHaveAttribute("href", "/admin/settings/authentication/oidc");
  });

  it("shows whether a configured method is active", async () => {
    setup({
      settingValues: {
        "oidc-configured": true,
        "oidc-enabled": true,
        "jwt-configured": true,
        "jwt-enabled": false,
      },
    });

    expect(
      await within(await screen.findByTestId("oidc-setting")).findByText(
        "Active",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("jwt-setting")).getByText("Paused"),
    ).toBeInTheDocument();
  });

  it("only offers to turn password login off once a single sign-on method is on", async () => {
    setup();

    expect(await screen.findByText("OpenID Connect")).toBeInTheDocument();
    expect(
      screen.queryByText("Enable password authentication"),
    ).not.toBeInTheDocument();
  });

  it("turns password login off", async () => {
    setup({ settingValues: { "oidc-configured": true, "oidc-enabled": true } });

    await userEvent.click(
      await screen.findByRole("switch", {
        name: /Enable password authentication/,
      }),
    );

    await waitFor(async () => {
      const puts = await findRequests("PUT");
      expect(puts).toHaveLength(1);
    });
    const [{ url, body }] = await findRequests("PUT");
    expect(url).toMatch(/\/api\/setting\/enable-password-login$/);
    expect(body).toEqual({ value: false });
  });
});
