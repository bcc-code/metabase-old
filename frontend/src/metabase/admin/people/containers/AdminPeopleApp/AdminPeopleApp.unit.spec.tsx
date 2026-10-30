import {
  createMockAdminAppState,
  createMockAdminState,
  createMockSettingsState,
  createMockState,
} from "__support__/state";
import { renderWithProviders, screen } from "__support__/ui";
import { createTenantsRouteGuard } from "metabase/admin/utils";
import { Route } from "metabase/router";
import type { EmbeddingHomepageStatus } from "metabase-types/api";
import {
  createMockTokenFeatures,
  createMockUser,
} from "metabase-types/api/mocks";

import { AdminPeopleApp } from "./AdminPeopleApp";

interface SetupOpts {
  activeUsersCount?: number;
  ssoEnabled?: boolean;
  isSuperUser?: boolean;
  useTenants?: boolean;
  setupEmbeddingAutoenabled?: boolean;
  embeddingHomepage?: EmbeddingHomepageStatus;
  hasTenantsFeature?: boolean;
}

const setup = async ({
  activeUsersCount = 50,
  ssoEnabled = false,
  isSuperUser = true,
  useTenants = false,
  setupEmbeddingAutoenabled = false,
  embeddingHomepage = "hidden",
  hasTenantsFeature = false,
}: SetupOpts = {}) => {
  const state = createMockState({
    currentUser: createMockUser({
      is_superuser: isSuperUser,
    }),
    settings: createMockSettingsState({
      "active-users-count": activeUsersCount,
      "embedding-homepage": embeddingHomepage,
      "setup-embedding-autoenabled": setupEmbeddingAutoenabled,
      "use-tenants": useTenants,
      "token-features": createMockTokenFeatures({
        sso_saml: ssoEnabled,
        tenants: hasTenantsFeature,
      }),
    }),
  });

  renderWithProviders(
    <Route path="/" element={<AdminPeopleApp />}>
      <Route index element={<>empty</>} />
    </Route>,
    {
      storeInitialState: state,
      withRouter: true,
    },
  );
};

const setupTenantRoute = async (initialRoute: string) => {
  const state = createMockState({
    admin: createMockAdminState({
      app: createMockAdminAppState({
        paths: [
          { key: "people", getName: () => "People", path: "/admin/people" },
        ],
      }),
    }),
    currentUser: createMockUser({
      is_superuser: true,
    }),
    settings: createMockSettingsState({
      "setup-embedding-autoenabled": true,
      "use-tenants": false,
      "token-features": createMockTokenFeatures({
        tenants: false,
      }),
    }),
  });

  const TenantsRouteGuard = createTenantsRouteGuard();

  renderWithProviders(
    <Route path="/admin/people" element={<AdminPeopleApp />}>
      <Route index element={<>people listing</>} />
      <Route path="tenants" element={<TenantsRouteGuard />}>
        <Route index element={<>tenants page</>} />
      </Route>
    </Route>,
    {
      initialRoute,
      storeInitialState: state,
      withRouter: true,
    },
  );
};

describe("AdminPeopleApp", () => {
  describe("sidebar", () => {
    it("should render only internal people and groups links if tenants is disabled", async () => {
      await setup();

      await assertNavLink("People", "/admin/people");
      await assertNavLink("Groups", "/admin/people/groups");
      expect(screen.queryByText("Tenants")).not.toBeInTheDocument();
      expect(screen.queryByText("Tenant users")).not.toBeInTheDocument();
    });

    it("should render both internal and external people links if tenants is enabled", async () => {
      await setup({ useTenants: true });

      await assertNavLink("Internal users", "/admin/people");
      await assertNavLink("Internal groups", "/admin/people/groups");
      await assertNavLink("Tenants", "/admin/people/tenants");
      await assertNavLink("Tenant users", "/admin/people/tenants/people");
    });

    it.each<Pick<SetupOpts, "setupEmbeddingAutoenabled" | "embeddingHomepage">>(
      [{ setupEmbeddingAutoenabled: true }, { embeddingHomepage: "visible" }],
    )(
      "should not link to tenants on embedding setup instances that do not use tenants (%o)",
      async (opts) => {
        await setup(opts);

        await assertNavLink("People", "/admin/people");
        expect(screen.queryByText("Tenants")).not.toBeInTheDocument();
        expect(screen.queryByTestId("upsell-gem")).not.toBeInTheDocument();
      },
    );

    it("should not show a paid-plan nudge to admins with many users and no SSO", async () => {
      await setup({ activeUsersCount: 500 });

      await assertNavLink("People", "/admin/people");
      expect(
        screen.queryByText(/tired of manually managing people/i),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: /metabase pro/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("tenant routes", () => {
    it("should redirect /admin/people/tenants to people when tenants are not in use", async () => {
      await setupTenantRoute("/admin/people/tenants");

      expect(await screen.findByText("people listing")).toBeInTheDocument();
      expect(screen.queryByText("tenants page")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Use a multi-tenant user strategy"),
      ).not.toBeInTheDocument();
    });
  });
});

async function assertNavLink(linkText: string, linkHref: string) {
  const linkLabel = await screen.findByText(linkText);
  const link =
    linkLabel.closest("a") ?? document.querySelector(`a[href="${linkHref}"]`);

  expect(link).toBeInTheDocument();
  expect(link).toHaveAttribute("href", linkHref);
}
