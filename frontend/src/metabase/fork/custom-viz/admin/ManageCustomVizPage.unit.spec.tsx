import userEvent from "@testing-library/user-event";
import fetchMock from "fetch-mock";

import {
  setupCustomVizPluginsEndpoint,
  setupDeleteCustomVizPluginEndpoint,
  setupPropertiesEndpoints,
  setupSettingsEndpoints,
  setupUpdateCustomVizPluginEndpoint,
} from "__support__/server-mocks";
import { renderWithProviders, screen, waitFor, within } from "__support__/ui";
import { Route } from "metabase/router";
import type { CustomVizPlugin } from "metabase-types/api";
import {
  createMockCustomVizPlugin,
  createMockSettingDefinition,
  createMockSettings,
} from "metabase-types/api/mocks";

import { ManageCustomVizPage } from "./ManageCustomVizPage";

const HERON_RING = createMockCustomVizPlugin({
  id: 1,
  identifier: "heron-ring",
  display_name: "Heron ring",
  icon: "progress",
});

const BROKEN_EGRET = createMockCustomVizPlugin({
  id: 2,
  identifier: "broken-egret",
  display_name: "Broken egret",
  status: "error",
  error_message:
    "The bundle was written for custom visualization API version 2, but this server supports version 1.",
});

interface SetupOpts {
  plugins: CustomVizPlugin[];
}

async function setup({ plugins }: SetupOpts) {
  setupCustomVizPluginsEndpoint(plugins);
  setupPropertiesEndpoints(createMockSettings());
  setupSettingsEndpoints([
    createMockSettingDefinition({
      key: "custom-visualizations-enabled",
      value: true,
    }),
  ]);

  renderWithProviders(<Route path="*" element={<ManageCustomVizPage />} />, {
    withRouter: true,
    withUndos: true,
    initialRoute: "/admin/settings/custom-visualizations",
  });

  await screen.findByText("Installed visualizations");
}

describe("ManageCustomVizPage", () => {
  it("lists the installed visualizations with their status", async () => {
    await setup({ plugins: [HERON_RING, BROKEN_EGRET] });

    const heronRing = await screen.findByRole("listitem", {
      name: "Heron ring",
    });
    expect(within(heronRing).getByText("Active")).toBeInTheDocument();
    expect(
      within(heronRing).getByText("Identifier: heron-ring"),
    ).toBeInTheDocument();
    expect(
      within(heronRing).getByRole("switch", { name: "Enable Heron ring" }),
    ).toBeChecked();

    const brokenEgret = screen.getByRole("listitem", { name: "Broken egret" });
    expect(within(brokenEgret).getByText("Error")).toBeInTheDocument();
    expect(
      within(brokenEgret).getByText(BROKEN_EGRET.error_message ?? ""),
    ).toBeInTheDocument();
  });

  it("warns that bundles run as trusted code", async () => {
    await setup({ plugins: [] });

    expect(
      screen.getByText("Only install visualizations you trust"),
    ).toBeInTheDocument();
  });

  it("says when nothing is installed yet and links to adding one", async () => {
    await setup({ plugins: [] });

    expect(
      await screen.findByText(
        "No custom visualizations yet. Add one by uploading its JavaScript bundle.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Add visualization/ }),
    ).toHaveAttribute("href", "/admin/settings/custom-visualizations/new");
  });

  it("disables a visualization", async () => {
    await setup({ plugins: [HERON_RING] });
    setupUpdateCustomVizPluginEndpoint({ ...HERON_RING, enabled: false });

    await userEvent.click(
      await screen.findByRole("switch", { name: "Enable Heron ring" }),
    );

    await waitFor(async () => {
      const call = fetchMock.callHistory.lastCall(
        "path:/api/custom-viz-plugin/1",
        { method: "PUT" },
      );
      const body: unknown = await call?.request?.clone().json();
      expect(body).toEqual({ enabled: false });
    });
  });

  it("deletes a visualization after confirming", async () => {
    await setup({ plugins: [HERON_RING] });
    setupDeleteCustomVizPluginEndpoint(HERON_RING.id);

    await userEvent.click(
      await screen.findByRole("button", {
        name: "More actions for Heron ring",
      }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /Delete/ }),
    );

    const modal = await screen.findByRole("dialog");
    expect(within(modal).getByText("Delete Heron ring?")).toBeInTheDocument();
    await userEvent.click(
      within(modal).getByRole("button", { name: "Delete" }),
    );

    await waitFor(() => {
      expect(
        fetchMock.callHistory.called("path:/api/custom-viz-plugin/1", {
          method: "DELETE",
        }),
      ).toBe(true);
    });
  });

  it("links to replacing a visualization's bundle", async () => {
    await setup({ plugins: [HERON_RING] });

    await userEvent.click(
      await screen.findByRole("button", {
        name: "More actions for Heron ring",
      }),
    );

    expect(
      await screen.findByRole("menuitem", { name: /Replace bundle/ }),
    ).toHaveAttribute("href", "/admin/settings/custom-visualizations/edit/1");
  });
});
