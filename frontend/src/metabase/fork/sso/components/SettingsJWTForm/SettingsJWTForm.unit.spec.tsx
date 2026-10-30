import userEvent from "@testing-library/user-event";
import fetchMock from "fetch-mock";

import {
  findRequests,
  setupGenerateRandomTokenEndpoint,
  setupSettingsEndpoints,
  setupStatefulSettingsEndpoints,
  setupUpdateJwtSsoSettingsEndpoint,
} from "__support__/server-mocks";
import { renderWithProviders, screen, waitFor } from "__support__/ui";
import type {
  EnterpriseSettingKey,
  EnterpriseSettings,
  SettingDefinition,
} from "metabase-types/api";
import { createMockGroup, createMockSettings } from "metabase-types/api/mocks";

import { SettingsJWTForm } from "./SettingsJWTForm";

const GENERATED_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const DEFINITIONS: SettingDefinition[] = [
  { key: "jwt-attribute-email", default: "email" },
  { key: "jwt-attribute-firstname", default: "first_name" },
  { key: "jwt-attribute-lastname", default: "last_name" },
  { key: "jwt-attribute-groups", default: "groups" },
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
  title?: string | null;
}

const setup = ({ settingValues = {}, title }: SetupOpts = {}) => {
  setupSettingsEndpoints([...DEFINITIONS, ...toDefinitions(settingValues)]);
  setupStatefulSettingsEndpoints(
    createMockSettings({
      "jwt-enabled": false,
      "jwt-configured": false,
      "jwt-user-provisioning-enabled?": true,
      ...settingValues,
    }),
  );
  setupUpdateJwtSsoSettingsEndpoint();
  setupGenerateRandomTokenEndpoint(GENERATED_KEY);
  fetchMock.get("path:/api/permissions/group", [
    createMockGroup({
      id: 1,
      name: "All Users",
      magic_group_type: "all-internal-users",
    }),
  ]);

  renderWithProviders(
    title === undefined ? (
      <SettingsJWTForm />
    ) : (
      <SettingsJWTForm title={title} />
    ),
  );
};

describe("SettingsJWTForm", () => {
  it("generates a signing key, saves the settings and turns JWT on", async () => {
    setup();

    await userEvent.type(
      await screen.findByLabelText(/JWT identity provider URI/),
      "https://idp.example.com/login",
    );
    await userEvent.click(screen.getByRole("button", { name: "Set up key" }));
    expect(await screen.findByDisplayValue(GENERATED_KEY)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Save and enable" }),
    );

    await waitFor(async () => {
      expect(await findRequests("PUT")).toHaveLength(1);
    });
    const [{ url, body }] = await findRequests("PUT");
    expect(url).toMatch(/\/api\/sso\/jwt\/settings$/);
    expect(body).toEqual({
      "jwt-enabled": true,
      "jwt-identity-provider-uri": "https://idp.example.com/login",
      "jwt-shared-secret": GENERATED_KEY,
      "jwt-attribute-email": null,
      "jwt-attribute-firstname": null,
      "jwt-attribute-lastname": null,
      "jwt-attribute-groups": null,
      "jwt-user-attributes": null,
      "jwt-user-provisioning-enabled?": true,
    });
  });

  it("does not save without an identity provider URI and a signing key", async () => {
    setup();

    await userEvent.type(
      await screen.findByLabelText(/JWT identity provider URI/),
      "not a url",
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

  it("keeps the saved signing key masked", async () => {
    setup({
      settingValues: {
        "jwt-identity-provider-uri": "https://idp.example.com/login",
        "jwt-shared-secret": "**********ef",
        "jwt-configured": true,
        "jwt-enabled": true,
      },
    });

    expect(await screen.findByDisplayValue("**********ef")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Regenerate key" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("has a heading of its own unless the page around it supplies one", async () => {
    setup();
    expect(
      await screen.findByRole("heading", { name: "JWT" }),
    ).toBeInTheDocument();
  });

  it("can leave the heading out", async () => {
    setup({ title: null });
    expect(
      await screen.findByLabelText(/JWT identity provider URI/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "JWT" }),
    ).not.toBeInTheDocument();
  });
});
