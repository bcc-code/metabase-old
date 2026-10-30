import userEvent from "@testing-library/user-event";
import fetchMock from "fetch-mock";

import {
  setupPropertiesEndpoints,
  setupSettingsEndpoints,
  setupUpdateSettingEndpoint,
} from "__support__/server-mocks";
import { mockSettings } from "__support__/settings";
import { createMockState } from "__support__/state";
import { renderWithProviders, screen, waitFor } from "__support__/ui";
import { PLUGIN_CUSTOM_VIZ } from "metabase/plugins";
import { Route } from "metabase/router";
import * as domUtils from "metabase/utils/dom";
import {
  createMockSettingDefinition,
  createMockSettings,
  createMockTokenFeatures,
} from "metabase-types/api/mocks";

import { CustomVisualizationsManagePage } from "./CustomVisualizationsSettingsPage";

interface SetupOpts {
  isCustomVizOn: boolean;
}

function setup({ isCustomVizOn }: SetupOpts) {
  const settings = createMockSettings({
    "custom-visualizations-enabled": isCustomVizOn,
    "token-features": createMockTokenFeatures({ "custom-viz": isCustomVizOn }),
  });
  setupPropertiesEndpoints(settings);
  setupSettingsEndpoints([
    createMockSettingDefinition({
      key: "custom-visualizations-enabled",
      value: isCustomVizOn,
    }),
  ]);
  setupUpdateSettingEndpoint();

  renderWithProviders(
    <Route path="*" element={<CustomVisualizationsManagePage />} />,
    {
      withRouter: true,
      withUndos: true,
      initialRoute: "/admin/settings/custom-visualizations",
      storeInitialState: createMockState({
        settings: mockSettings(settings),
      }),
    },
  );
}

describe("CustomVisualizationsManagePage", () => {
  const originalManagePage = PLUGIN_CUSTOM_VIZ.ManageCustomVizPage;

  beforeEach(() => {
    PLUGIN_CUSTOM_VIZ.ManageCustomVizPage = () => <div>Manage page</div>;
    jest.spyOn(domUtils, "reload").mockImplementation(() => undefined);
  });

  afterEach(() => {
    PLUGIN_CUSTOM_VIZ.ManageCustomVizPage = originalManagePage;
    jest.restoreAllMocks();
  });

  it("shows the management page while custom visualizations are on", () => {
    setup({ isCustomVizOn: true });

    expect(screen.getByText("Manage page")).toBeInTheDocument();
    expect(
      screen.queryByText("Custom visualizations are turned off"),
    ).not.toBeInTheDocument();
  });

  it("offers to turn custom visualizations back on, without any upsell", async () => {
    setup({ isCustomVizOn: false });

    expect(
      screen.getByText("Custom visualizations are turned off"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Manage page")).not.toBeInTheDocument();
    expect(screen.queryByText(/Try for free/)).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Turn on custom visualizations" }),
    );

    await waitFor(() => {
      expect(domUtils.reload).toHaveBeenCalled();
    });
    const call = fetchMock.callHistory.lastCall(
      "path:/api/setting/custom-visualizations-enabled",
      { method: "PUT" },
    );
    const body: unknown = await call?.request?.json();
    expect(body).toEqual({ value: true });
  });
});
