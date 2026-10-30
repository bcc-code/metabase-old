import {
  setupPropertiesEndpoints,
  setupSettingsEndpoints,
  setupUserKeyValueEndpoints,
} from "__support__/server-mocks";
import { mockSettings } from "__support__/settings";
import { createMockState } from "__support__/state";
import { renderWithProviders, screen, within } from "__support__/ui";
import { Route } from "metabase/router";
import type { TokenFeatures } from "metabase-types/api";
import {
  createMockSettings,
  createMockTokenFeatures,
  createMockUser,
} from "metabase-types/api/mocks";

import { EmbeddingHubLayout } from "./EmbeddingHubLayout";

jest.mock("metabase/embedding/themes/hooks", () => ({
  useEnsureDefaultEmbeddingThemes: jest.fn(),
}));

jest.mock("metabase/nav/components/AppSwitcher", () => ({
  AppSwitcher: () => null,
}));

const TAB_LABELS = [
  "Get started",
  "Security",
  "Authentication",
  "Permissions",
  "Tenancy",
  "Appearance",
  "Localization",
];

const ALL_TAB_FEATURES: Partial<TokenFeatures> = {
  sso_jwt: true,
  tenants: true,
  embedding_simple: true,
  content_translation: true,
};

type SetupOptions = {
  initialRoute?: string;
  isNavbarOpened?: boolean;
  tokenFeatures?: Partial<TokenFeatures>;
};

function setup({
  initialRoute = "/embedding/get-started",
  isNavbarOpened = true,
  tokenFeatures: tokenFeatureOverrides = ALL_TAB_FEATURES,
}: SetupOptions = {}) {
  const tokenFeatures = createMockTokenFeatures(tokenFeatureOverrides);

  setupSettingsEndpoints([]);
  setupPropertiesEndpoints(
    createMockSettings({ "token-features": tokenFeatures }),
  );
  setupUserKeyValueEndpoints({
    namespace: "embedding_hub",
    key: "isNavbarOpened",
    value: isNavbarOpened,
  });

  return renderWithProviders(
    <Route path="/embedding" element={<EmbeddingHubLayout />}>
      <Route path="get-started">
        <Route index element={<div>{"Get started body"}</div>} />
        <Route
          path="permissions"
          element={<div>{"Permissions wizard body"}</div>}
        />
      </Route>
      <Route path="security" element={<div>{"Security body"}</div>} />
    </Route>,
    {
      withRouter: true,
      initialRoute,
      storeInitialState: createMockState({
        currentUser: createMockUser({ is_superuser: true }),
        settings: mockSettings({ "token-features": tokenFeatures }),
      }),
    },
  );
}

function findNav() {
  return screen.findByRole("navigation", { name: "Embedding hub" });
}

describe("EmbeddingHubLayout", () => {
  it("renders every tab, in design order, each linking to its own path", async () => {
    setup();

    const nav = await findNav();
    const links = within(nav).getAllByRole("link");

    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual(
      TAB_LABELS,
    );
    expect(
      await within(nav).findByRole("link", { name: "Get started" }),
    ).toHaveAttribute("href", "/embedding/get-started");
  });

  it("leaves out the tabs whose feature the instance lacks", async () => {
    setup({ tokenFeatures: {} });

    const nav = await findNav();
    const links = within(nav).getAllByRole("link");

    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual([
      "Get started",
      "Security",
      "Permissions",
    ]);
    expect(within(nav).queryByTestId("upsell-gem")).not.toBeInTheDocument();
  });

  it.each([
    { feature: "sso_jwt", label: "Authentication" },
    { feature: "tenants", label: "Tenancy" },
    { feature: "embedding_simple", label: "Appearance" },
    { feature: "content_translation", label: "Localization" },
  ] as const)(
    "shows the $label tab, without a gem, only with $feature",
    async ({ feature, label }) => {
      setup({ tokenFeatures: { [feature]: true } });

      const nav = await findNav();

      expect(
        await within(nav).findByRole("link", { name: label }),
      ).toBeInTheDocument();
      expect(within(nav).queryByTestId("upsell-gem")).not.toBeInTheDocument();
    },
  );

  it("keeps Get started current on the setup wizard sub-pages", async () => {
    setup({ initialRoute: "/embedding/get-started/permissions" });

    const nav = await findNav();

    // The wizard belongs to Get started, so the nav must not go blank there.
    expect(
      await within(nav).findByRole("link", { name: "Get started" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("does not light up Permissions on the permissions wizard", async () => {
    setup({ initialRoute: "/embedding/get-started/permissions" });

    const nav = await findNav();

    // The wizard belongs to Get started, so Permissions must not claim it.
    expect(
      await within(nav).findByRole("link", { name: "Permissions" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("keeps the width cap on the permissions wizard", async () => {
    setup({ initialRoute: "/embedding/get-started/permissions" });

    await screen.findByText("Permissions wizard body");

    expect(screen.getByTestId("embedding-hub-content-cap")).toBeInTheDocument();
  });

  describe("New embed button", () => {
    it("shows its label while the navbar is open", async () => {
      setup({ isNavbarOpened: true });

      expect(
        await screen.findByRole("button", { name: "New embed" }),
      ).toHaveTextContent("New embed");
    });

    it("collapses to the icon alone once the navbar is closed", async () => {
      setup({ isNavbarOpened: false });

      const button = await screen.findByRole("button", { name: "New embed" });

      expect(button).toHaveTextContent("");
    });
  });
});
