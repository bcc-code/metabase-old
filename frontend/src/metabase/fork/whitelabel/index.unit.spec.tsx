import { render as testingLibraryRender } from "@testing-library/react";

import {
  setupPropertiesEndpoints,
  setupSettingEndpoint,
  setupSettingsEndpoints,
} from "__support__/server-mocks";
import { mockSettings } from "__support__/settings";
import { createMockState } from "__support__/state";
import {
  getTestStoreAndWrapper,
  renderWithProviders,
  screen,
} from "__support__/ui";
import { getSettingsRoutes } from "metabase/admin/settingsRoutes";
import { LogoIcon } from "metabase/common/components/LogoIcon";
import {
  PLUGIN_HOMEPAGE_SETTING,
  PLUGIN_LANDING_PAGE,
  PLUGIN_SELECTORS,
  reinitialize,
} from "metabase/plugins";
import { SyncedEmbedFrame } from "metabase/public/components/EmbedFrame";
import PublicApp from "metabase/public/containers/PublicApp/PublicApp";
import { Route } from "metabase/router";
import type { EnterpriseSettings } from "metabase-types/api";
import { createMockSettings, createMockUser } from "metabase-types/api/mocks";

import { initializeWhitelabelPlugin } from "./index";

const LOGO_DATA_URI = `data:image/png;base64,${btoa("logo")}`;

interface SetupOpts {
  settings?: Partial<EnterpriseSettings>;
}

function getState({ settings = {} }: SetupOpts = {}) {
  return createMockState({
    settings: mockSettings(settings),
    currentUser: createMockUser({ is_superuser: true }),
  });
}

async function setupSettingsPage({ initialRoute }: { initialRoute: string }) {
  const settings = createMockSettings({ "available-fonts": ["Lato"] });
  setupPropertiesEndpoints(settings);
  setupSettingsEndpoints([]);
  setupSettingEndpoint({
    settingKey: "version-info",
    settingValue: settings["version-info"],
  });

  const { wrapper, store } = getTestStoreAndWrapper({
    storeInitialState: getState({ settings }),
    withRouter: true,
    initialRoute: `/admin/settings${initialRoute}`,
  });

  testingLibraryRender(
    <Route path="admin/settings">{getSettingsRoutes(store)}</Route>,
    { wrapper },
  );
}

function setupPublicDashboard({
  showMetabaseLinks,
}: {
  showMetabaseLinks: boolean;
}) {
  renderWithProviders(
    <Route path="/public/dashboard/:id" element={<PublicApp />}>
      <Route
        index
        element={
          <SyncedEmbedFrame>
            <h1>{"Dashboard"}</h1>
          </SyncedEmbedFrame>
        }
      />
    </Route>,
    {
      mode: "public",
      initialRoute: "/public/dashboard/UUID",
      storeInitialState: {
        settings: mockSettings({
          "hide-embed-branding?": false,
          "show-metabase-links": showMetabaseLinks,
        }),
      },
      withRouter: true,
    },
  );
}

describe("initializeWhitelabelPlugin", () => {
  beforeEach(() => {
    initializeWhitelabelPlugin();
  });

  afterEach(() => {
    reinitialize();
  });

  it("renders the branding page in the appearance settings", async () => {
    await setupSettingsPage({ initialRoute: "/whitelabel/branding" });

    expect(
      await screen.findByText(/Make the app look like yours/),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Use BCC theme" }),
    ).toBeInTheDocument();
  });

  it("renders the conceal page in the appearance settings", async () => {
    await setupSettingsPage({ initialRoute: "/whitelabel/conceal-metabase" });

    expect(
      await screen.findByText(
        /Hide the parts of the app that point to Metabase/,
      ),
    ).toBeInTheDocument();
  });

  it("shows the uploaded logo wherever the app shows its logo", () => {
    renderWithProviders(<LogoIcon height={32} />, {
      storeInitialState: getState({
        settings: { "application-logo-url": LOGO_DATA_URI },
      }),
    });

    expect(screen.getByTestId("main-logo")).toHaveAttribute(
      "src",
      LOGO_DATA_URI,
    );
  });

  it("applies the branding settings through the whitelabel selectors", () => {
    const state = getState({
      settings: {
        "application-name": "BCC Insights",
        "show-metabase-links": false,
        "loading-message": "loading-results",
      },
    });

    expect(PLUGIN_SELECTORS.canWhitelabel(state)).toBe(true);
    expect(PLUGIN_SELECTORS.getApplicationName(state)).toBe("BCC Insights");
    expect(PLUGIN_SELECTORS.getIsWhiteLabeling(state)).toBe(true);
    expect(PLUGIN_SELECTORS.getShowMetabaseLinks(state)).toBe(false);
    expect(PLUGIN_SELECTORS.getLoadingMessageFactory(state)()).toBe(
      "Loading results...",
    );
  });

  it("shows the Powered by badge on public links", () => {
    setupPublicDashboard({ showMetabaseLinks: true });

    expect(
      screen.getByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Powered by")).toBeInTheDocument();
  });

  it("hides the Powered by badge on public links when Metabase links are concealed", () => {
    setupPublicDashboard({ showMetabaseLinks: false });

    expect(
      screen.getByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Powered by")).not.toBeInTheDocument();
  });

  it("redirects to the custom landing page and offers it in the homepage setting", () => {
    getState({ settings: { "landing-page": "/collection/2" } });

    expect(PLUGIN_LANDING_PAGE.getLandingPage()).toBe("/collection/2");
    expect(PLUGIN_HOMEPAGE_SETTING.CustomUrlOption?.label).toBe("Custom URL");
  });
});
