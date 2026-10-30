import userEvent from "@testing-library/user-event";
import fetchMock from "fetch-mock";

import {
  findRequests,
  setupCheckOidcConnectionEndpoint,
  setupOidcSsoInfoEndpoint,
  setupSettingsEndpoints,
  setupStatefulSettingsEndpoints,
  setupUpdateOidcSsoSettingsEndpoint,
} from "__support__/server-mocks";
import { renderWithProviders, screen, waitFor } from "__support__/ui";
import type {
  EnterpriseSettingKey,
  EnterpriseSettings,
  OidcSsoInfo,
  SettingDefinition,
} from "metabase-types/api";
import { createMockGroup, createMockSettings } from "metabase-types/api/mocks";

import { SettingsOIDCForm } from "./SettingsOIDCForm";

const DEFINITIONS: SettingDefinition[] = [
  { key: "oidc-scopes", default: "openid email profile" },
  { key: "oidc-attribute-email", default: "email" },
  { key: "oidc-attribute-firstname", default: "given_name" },
  { key: "oidc-attribute-lastname", default: "family_name" },
];

// the admin list only carries values that were set, so the test values stand in for those
const toDefinitions = (
  values: Partial<EnterpriseSettings>,
): SettingDefinition[] =>
  // Object.keys widens the keys of a typed record to string
  (Object.keys(values) as EnterpriseSettingKey[]).map((key) => ({
    key,
    value: values[key],
  }));

interface SetupOpts {
  settingValues?: Partial<EnterpriseSettings>;
  info?: OidcSsoInfo;
}

const setup = ({ settingValues = {}, info }: SetupOpts = {}) => {
  setupSettingsEndpoints([...DEFINITIONS, ...toDefinitions(settingValues)]);
  setupStatefulSettingsEndpoints(
    createMockSettings({
      "oidc-enabled": false,
      "oidc-configured": false,
      "oidc-user-provisioning-enabled?": true,
      ...settingValues,
    }),
  );
  setupOidcSsoInfoEndpoint(info);
  setupUpdateOidcSsoSettingsEndpoint();
  fetchMock.get("path:/api/permissions/group", [
    createMockGroup({
      id: 1,
      name: "All Users",
      magic_group_type: "all-internal-users",
    }),
  ]);

  renderWithProviders(<SettingsOIDCForm />);
};

describe("SettingsOIDCForm", () => {
  it("shows the redirect URI to register with the identity provider", async () => {
    setup();

    expect(await screen.findByLabelText("Redirect URI")).toHaveValue(
      "http://localhost:3000/auth/sso/oidc/callback",
    );
  });

  it("asks for the site URL when the redirect URI isn't known yet", async () => {
    setup({ info: { "redirect-uri": null, "encryption-enabled": true } });

    expect(
      await screen.findByText(/Set the site URL in the General settings/),
    ).toBeInTheDocument();
  });

  it("warns when the encryption key sign-in needs is missing", async () => {
    setup({
      info: {
        "redirect-uri": "http://localhost:3000/auth/sso/oidc/callback",
        "encryption-enabled": false,
      },
    });

    expect(
      await screen.findByText(/needs the MB_ENCRYPTION_SECRET_KEY/),
    ).toBeInTheDocument();
  });

  it("saves the settings and turns sign-in on", async () => {
    setup();

    await userEvent.type(
      await screen.findByLabelText(/Issuer URI/),
      "https://login.example.com/",
    );
    await userEvent.type(screen.getByLabelText(/Client ID/), "client-123");
    await userEvent.type(screen.getByLabelText(/Client secret/), "s3cret");
    await userEvent.type(
      screen.getByLabelText("Button label"),
      "Sign in with Example",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save and enable" }),
    );

    await waitFor(async () => {
      const puts = await findRequests("PUT");
      expect(puts).toHaveLength(1);
    });
    const [{ url, body }] = await findRequests("PUT");
    expect(url).toMatch(/\/api\/sso\/oidc\/settings$/);
    expect(body).toEqual({
      "oidc-enabled": true,
      "oidc-issuer-uri": "https://login.example.com/",
      "oidc-client-id": "client-123",
      "oidc-client-secret": "s3cret",
      "oidc-login-prompt": "Sign in with Example",
      "oidc-scopes": null,
      "oidc-authorization-params": null,
      "oidc-allowed-email-domains": null,
      "oidc-attribute-email": null,
      "oidc-attribute-firstname": null,
      "oidc-attribute-lastname": null,
      "oidc-attribute-groups": null,
      "oidc-user-attributes": null,
      "oidc-user-provisioning-enabled?": true,
    });
  });

  it("requires a valid issuer URI, client ID and client secret", async () => {
    setup();

    await userEvent.type(
      await screen.findByLabelText(/Issuer URI/),
      "login.example.com",
    );
    await userEvent.tab();

    expect(
      await screen.findByText(
        "Enter a URL that starts with https:// or http://",
      ),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Save and enable" }),
    );
    expect(await findRequests("PUT")).toHaveLength(0);
  });

  it("checks the connection with the values in the form", async () => {
    setupCheckOidcConnectionEndpoint({
      ok: false,
      issuer: "https://login.example.com/",
      discovery: {
        success: true,
        message: "Found the provider's discovery document.",
      },
      credentials: {
        success: false,
        verified: true,
        message: "The provider rejected the client ID or client secret.",
      },
    });
    setup({
      settingValues: {
        "oidc-issuer-uri": "https://login.example.com/",
        "oidc-client-id": "client-123",
        "oidc-client-secret": "**********et",
        "oidc-configured": true,
        "oidc-enabled": true,
      },
    });

    await userEvent.click(
      await screen.findByRole("button", { name: "Check connection" }),
    );

    expect(
      await screen.findByText("Found the provider's discovery document."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The provider rejected the client ID or client secret."),
    ).toBeInTheDocument();
    const [{ body }] = await findRequests("POST");
    expect(body).toEqual({
      "issuer-uri": "https://login.example.com/",
      "client-id": "client-123",
      "client-secret": "**********et",
    });
  });

  it("offers to save changes once sign-in is on", async () => {
    setup({
      settingValues: {
        "oidc-issuer-uri": "https://login.example.com/",
        "oidc-client-id": "client-123",
        "oidc-client-secret": "**********et",
        "oidc-configured": true,
        "oidc-enabled": true,
      },
    });

    expect(
      await screen.findByRole("button", { name: "Save changes" }),
    ).toBeDisabled();
  });
});
