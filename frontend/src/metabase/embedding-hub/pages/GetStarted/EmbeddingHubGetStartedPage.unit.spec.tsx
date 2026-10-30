import userEvent from "@testing-library/user-event";
import fetchMock from "fetch-mock";

import { setupEnterprisePlugins } from "__support__/enterprise";
import {
  setupDatabaseListEndpoint,
  setupLlmProviderTypesEndpoint,
  setupLlmProvidersEndpoint,
  setupPropertiesEndpoints,
  setupRecentViewsAndSelectionsEndpoints,
  setupSearchEndpoints,
  setupSettingsEndpoints,
  setupTokenStatusEndpoint,
} from "__support__/server-mocks";
import { mockSettings } from "__support__/settings";
import { createMockState } from "__support__/state";
import { renderWithProviders, screen, within } from "__support__/ui";
import type { SetupGuideChecklist } from "metabase/embedding/setup-guide/api/setup-guide";
import { Route } from "metabase/router";
import {
  createMockSettings,
  createMockTokenFeatures,
  createMockUser,
} from "metabase-types/api/mocks";

import { EmbeddingHubGetStartedPage } from "./EmbeddingHubGetStartedPage";

const THEME_CARD = "Create a custom theme";
const AI_CARD = "Configure AI";
const TENANTS_CARD = "Configure data permissions and tenants";
const SSO_CARD = "Set up SSO";
const PRODUCTION_CARD = "Embed in production with SSO";

interface SetupOpts {
  hasSimpleEmbedding?: boolean;
  hasSsoJwt?: boolean;
  hasTenants?: boolean;
  checklist?: Partial<SetupGuideChecklist>;
  isLlmConfigured?: boolean;
  isEmbeddedMetabotEnabled?: boolean;
}

function setup({
  hasSimpleEmbedding = false,
  hasSsoJwt = false,
  hasTenants = false,
  checklist = {},
  isLlmConfigured = false,
  isEmbeddedMetabotEnabled = true,
}: SetupOpts = {}) {
  const settings = createMockSettings({
    "token-features": createMockTokenFeatures({
      embedding_simple: hasSimpleEmbedding,
      sso_jwt: hasSsoJwt,
      tenants: hasTenants,
    }),
    "llm-metabot-configured?": isLlmConfigured,
    "embedded-metabot-enabled?": isEmbeddedMetabotEnabled,
  });

  fetchMock.get("path:/api/embedding-hub/checklist", {
    checklist,
    "data-isolation-strategy": null,
  });

  setupPropertiesEndpoints(settings);
  setupSettingsEndpoints([]);
  setupSearchEndpoints([]);
  setupDatabaseListEndpoint([]);
  setupRecentViewsAndSelectionsEndpoints([], ["selections"]);
  setupTokenStatusEndpoint({ valid: true });

  // The AI card opens AIProviderConfigurationModal, which loads both.
  setupLlmProvidersEndpoint([]);
  setupLlmProviderTypesEndpoint([]);

  // Settings before plugins: the shared checklist drops the tenants step when
  // PLUGIN_TENANTS.isEnabled is false, and that registration reads the mock.
  const storeSettings = mockSettings(settings);
  setupEnterprisePlugins();

  return renderWithProviders(
    <Route
      path="/embedding/get-started"
      element={<EmbeddingHubGetStartedPage />}
    />,
    {
      withRouter: true,
      initialRoute: "/embedding/get-started",
      storeInitialState: createMockState({
        settings: storeSettings,
        currentUser: createMockUser({ is_superuser: true }),
      }),
    },
  );
}

/**
 * The card whose own subtree carries the given title.
 *
 * An unlocked card is a real control -- an anchor or a button -- with the
 * title as its accessible name, so it is found by role. A locked card is
 * deliberately inert: no link, no button, no role at all, since it is not
 * meant to be reachable. There is nothing to query by role there, so it
 * falls back to the container testid, scoped by the title text within it.
 */
function queryCard(title: string) {
  const control =
    screen.queryByRole("link", { name: title }) ??
    screen.queryByRole("button", { name: title });

  if (control) {
    return control;
  }

  return (
    screen
      .queryAllByTestId("embedding-hub-checklist-card")
      .find((card) => within(card).queryByText(title) != null) ?? null
  );
}

function getCard(title: string) {
  const card = queryCard(title);

  if (!card) {
    throw new Error(`No checklist card found for "${title}"`);
  }

  return card;
}

function isLocked(title: string) {
  return getCard(title).getAttribute("aria-disabled") === "true";
}

describe("EmbeddingHubGetStartedPage", () => {
  describe("per-feature steps", () => {
    it("leaves out every Fine-tune step when the instance has none of their features", async () => {
      setup();

      // AI needs no paid feature, so it is always there.
      expect(await screen.findByText(AI_CARD)).toBeInTheDocument();

      [TENANTS_CARD, SSO_CARD, PRODUCTION_CARD, THEME_CARD].forEach((title) => {
        expect(queryCard(title)).not.toBeInTheDocument();
      });
      expect(
        screen.queryByRole("heading", { name: "Fine-tune your embed" }),
      ).not.toBeInTheDocument();
    });

    it("keys each step off its own feature, not one blanket check", async () => {
      setup({ hasSsoJwt: true });

      expect(await screen.findByText(SSO_CARD)).toBeInTheDocument();

      expect(isLocked(SSO_CARD)).toBe(false);
      expect(queryCard(TENANTS_CARD)).not.toBeInTheDocument();
      expect(queryCard(THEME_CARD)).not.toBeInTheDocument();
    });

    it("shows the tenants step on its own feature", async () => {
      setup({ hasTenants: true });

      expect(await screen.findByText(TENANTS_CARD)).toBeInTheDocument();
      expect(isLocked(TENANTS_CARD)).toBe(false);
      expect(queryCard(SSO_CARD)).not.toBeInTheDocument();
    });

    it("shows the theme step on embedding_simple", async () => {
      setup({ hasSimpleEmbedding: true });

      expect(await screen.findByText(THEME_CARD)).toBeInTheDocument();
      expect(isLocked(THEME_CARD)).toBe(false);
      expect(queryCard(SSO_CARD)).not.toBeInTheDocument();
    });

    it("opens a new theme and tags it to return here", async () => {
      setup({ hasSimpleEmbedding: true });

      const card = await screen.findByRole("link", { name: THEME_CARD });

      expect(card).toHaveAttribute(
        "href",
        expect.stringContaining("/theme/new?return=get-started"),
      );
    });
  });

  describe("the production-embed prerequisite", () => {
    it("names the prerequisite once SSO is licensed but not configured", async () => {
      setup({ hasSsoJwt: true, checklist: { "sso-configured": false } });

      expect(await screen.findByText(PRODUCTION_CARD)).toBeInTheDocument();
      expect(isLocked(PRODUCTION_CARD)).toBe(true);

      // The reason is a tooltip, so it is in the DOM only once hovered.
      await userEvent.hover(getCard(PRODUCTION_CARD));

      expect(
        await screen.findByText("Set up SSO to unlock"),
      ).toBeInTheDocument();
    });

    it("leaves the step out when SSO is not available at all", async () => {
      setup({ hasSsoJwt: false });

      expect(await screen.findByText(AI_CARD)).toBeInTheDocument();
      expect(queryCard(PRODUCTION_CARD)).not.toBeInTheDocument();
    });

    it("unlocks once SSO is both licensed and configured", async () => {
      setup({
        hasSsoJwt: true,
        checklist: {
          "sso-configured": true,
          "sso-auth-manual-tested": true,
        },
      });

      await screen.findByText(SSO_CARD);

      expect(screen.getByText(PRODUCTION_CARD)).toBeInTheDocument();
      expect(isLocked(PRODUCTION_CARD)).toBe(false);
      expect(
        screen.queryByText("Set up SSO to unlock"),
      ).not.toBeInTheDocument();
    });
  });

  describe("the AI card's done state", () => {
    // Which settings make it done is the backend's business -- it reports
    // `configure-ai`, and the card just renders what the checklist says.
    it("is not done while the checklist says it is not", async () => {
      setup({ checklist: { "configure-ai": false } });

      expect(await screen.findByText(AI_CARD)).toBeInTheDocument();
      expect(
        within(getCard(AI_CARD)).queryByLabelText(/complete/),
      ).not.toBeInTheDocument();
    });

    it("is done when the checklist says so, and links out to admin", async () => {
      setup({ checklist: { "configure-ai": true } });

      // Before the checklist loads, the card is still the unconfigured
      // (button) variant -- querying by text alone would resolve against
      // that transient render and hold a stale node once it is swapped for
      // the link. Querying by the link role waits for the swap itself.
      const card = await screen.findByRole("link", { name: AI_CARD });

      expect(within(card).getByLabelText(/complete/)).toBeInTheDocument();

      // Configured, the card links out rather than reopening the modal.
      expect(card).toHaveAttribute("href", expect.stringContaining("/admin"));
    });

    it("opens the provider modal while unconfigured", async () => {
      setup({ checklist: { "configure-ai": false } });

      await userEvent.click(await screen.findByText(AI_CARD));

      expect(
        await screen.findByRole("dialog", {
          name: "Connect to an AI provider",
        }),
      ).toBeInTheDocument();
    });
  });

  describe("the first-embed blurb", () => {
    it("promises a simple embedded dashboard on pro, where the fine-tune steps exist", async () => {
      setup({ hasSimpleEmbedding: true });

      expect(
        await screen.findByText(
          "If all you want is a simple embedded dashboard, these steps are all you need.",
        ),
      ).toBeInTheDocument();
    });

    it("promises only the basics on OSS, where AI is not part of a simple embed", async () => {
      setup({ hasSimpleEmbedding: false });

      expect(
        await screen.findByText("Start with the basics of Metabase embedding."),
      ).toBeInTheDocument();
    });
  });

  describe("the Fine-tune subtitle", () => {
    it("shows no subtitle or upgrade banner without modular embedding", async () => {
      setup({ hasSimpleEmbedding: false, hasSsoJwt: true });

      expect(
        await screen.findByRole("heading", { name: "Fine-tune your embed" }),
      ).toBeInTheDocument();

      expect(
        screen.queryByText(
          "If you have a more sophisticated setup in mind, with many users and tenants, then keep going.",
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(
          "Upgrade to Metabase Pro to configure advanced options.",
        ),
      ).not.toBeInTheDocument();
    });

    it("shows the subtitle and no banner with modular embedding", async () => {
      setup({ hasSimpleEmbedding: true });

      expect(
        await screen.findByText(
          "If you have a more sophisticated setup in mind, with many users and tenants, then keep going.",
        ),
      ).toBeInTheDocument();

      expect(
        screen.queryByText(
          "Upgrade to Metabase Pro to configure advanced options.",
        ),
      ).not.toBeInTheDocument();
    });
  });

  describe("useful links", () => {
    it("tags all three with the embedding hub's campaign and page", async () => {
      setup();

      const links = ["Embedding methods", "Demo", "Documentation"];

      for (const label of links) {
        const link = await screen.findByRole("link", {
          name: new RegExp(label),
        });
        const { searchParams } = new URL(link.getAttribute("href") ?? "");

        expect(searchParams.get("utm_campaign")).toBe("embedding-hub");
        expect(searchParams.get("utm_content")).toBe(
          "embedding-hub-get-started-page",
        );
      }
    });
  });

  describe("the first-embed steps", () => {
    it("renders all three unlocked on every edition", async () => {
      setup();

      const titles = [
        "Connect a database",
        "Create a dashboard",
        "Get embed snippet",
      ];

      for (const title of titles) {
        expect(await screen.findByText(title)).toBeInTheDocument();
        expect(isLocked(title)).toBe(false);
      }
    });
  });
});
