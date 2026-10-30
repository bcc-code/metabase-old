import { setupCustomVizPluginRuntimesEndpoint } from "__support__/server-mocks";
import { mockSettings } from "__support__/settings";
import { createMockState } from "__support__/state";
import { renderWithProviders, screen } from "__support__/ui";
import VisualizationComponent from "metabase/visualizations/components/Visualization";
import { registerVisualizations } from "metabase/visualizations/register";
import { visualizations } from "metabase/viz-core";
import type {
  CustomVizDisplayType,
  DatasetData,
  VisualizationSettings,
} from "metabase-types/api";
import {
  createMockCard,
  createMockCategoryColumn,
  createMockDatasetData,
  createMockNumericColumn,
  createMockTokenFeatures,
} from "metabase-types/api/mocks";

import {
  EXAMPLE_BUNDLE_SOURCE,
  createRuntimePlugin,
  mockBundles,
} from "./test-utils";

import { initializeCustomVizPlugin } from "./index";

jest.mock("./load-script", () => ({ loadScript: jest.fn() }));

registerVisualizations();
initializeCustomVizPlugin();

const DISPLAY: CustomVizDisplayType = "custom:progress-ring";

const HERON_COUNT = createMockDatasetData({
  cols: [createMockNumericColumn({ name: "count", display_name: "Count" })],
  rows: [[50]],
});

const CRASHING_BUNDLE_SOURCE = `/* metabase-custom-viz
{"apiVersion": 1, "identifier": "crashing-viz", "name": "Crashing viz"}
*/
window.MetabaseCustomViz.define("crashing-viz", {
  mount: function () { throw new Error("The herons flew off"); }
});
`;

interface SetupOpts {
  source?: string;
  hash: string;
  display?: CustomVizDisplayType;
  data?: DatasetData;
  visualizationSettings?: VisualizationSettings;
}

async function setup({
  source = EXAMPLE_BUNDLE_SOURCE,
  hash,
  display = DISPLAY,
  data = HERON_COUNT,
  visualizationSettings = {},
}: SetupOpts) {
  const plugin = createRuntimePlugin(source, hash);
  setupCustomVizPluginRuntimesEndpoint([plugin]);
  mockBundles({ [plugin.bundle_url]: source });

  renderWithProviders(
    <VisualizationComponent
      rawSeries={[
        {
          card: createMockCard({
            name: "Herons spotted this year",
            display,
            visualization_settings: visualizationSettings,
          }),
          data,
        },
      ]}
    />,
    {
      storeInitialState: createMockState({
        settings: mockSettings({
          "token-features": createMockTokenFeatures({ "custom-viz": true }),
        }),
      }),
    },
  );
}

describe("custom visualizations", () => {
  afterEach(() => {
    visualizations.delete(DISPLAY);
  });

  it("loads the plugin of a saved question on demand and renders it with its settings", async () => {
    await setup({
      hash: "q1",
      visualizationSettings: {
        "custom:progress-ring:goal": 200,
        "custom:progress-ring:label": "Herons spotted",
      },
    });

    expect(await screen.findByText("Herons spotted")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.getByText("25% of 200")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "25%" })).toBeInTheDocument();
  });

  it("explains which data the plugin can't show", async () => {
    await setup({
      hash: "q2",
      data: createMockDatasetData({
        cols: [createMockCategoryColumn({ name: "species" })],
        rows: [["Heron"]],
      }),
    });

    expect(
      await screen.findByText(
        "This visualization needs at least 1 number column.",
      ),
    ).toBeInTheDocument();
  });

  it("shows what a crashing plugin threw inside the card", async () => {
    await setup({
      source: CRASHING_BUNDLE_SOURCE,
      hash: "q3",
      display: "custom:crashing-viz",
    });

    expect(
      await screen.findByText("This custom visualization ran into a problem."),
    ).toBeInTheDocument();
    expect(screen.getByText("The herons flew off")).toBeInTheDocument();
  });
});
