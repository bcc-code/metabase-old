import {
  getComputedSettingsForSeries,
  registerVisualization,
  visualizations,
} from "metabase/viz-core";
import type { CustomVizDisplayType } from "metabase-types/api";
import {
  createMockCard,
  createMockCategoryColumn,
  createMockDatasetData,
  createMockNumericColumn,
} from "metabase-types/api/mocks";

import type { CustomVizManifest } from "../types";

import { createCustomVisualization } from "./create-custom-visualization";
import { getCustomVizSettingValues } from "./settings";

const DISPLAY: CustomVizDisplayType = "custom:heron-ring";

const MANIFEST: CustomVizManifest = {
  apiVersion: 1,
  identifier: "heron-ring",
  name: "Heron ring",
  settings: [
    { id: "goal", type: "number", title: "Goal", default: 100 },
    { id: "label", type: "text", title: "Label" },
    {
      id: "shape",
      type: "select",
      title: "Shape",
      options: [
        { name: "Ring", value: "ring" },
        { name: "Bar", value: "bar" },
      ],
    },
    { id: "showGoal", type: "toggle", title: "Show goal" },
    { id: "color", type: "color", title: "Color", default: "#88BF4D" },
    { id: "value", type: "column", title: "Value", columnType: "number" },
    { id: "details", type: "columns", title: "Details", columnType: "string" },
  ],
};

const DATA = createMockDatasetData({
  cols: [
    createMockCategoryColumn({ name: "species" }),
    createMockNumericColumn({ name: "count" }),
    createMockNumericColumn({ name: "wingspan" }),
  ],
  rows: [["Heron", 3, 190]],
});

function getPluginSettings(visualizationSettings = {}) {
  const series = [
    {
      card: createMockCard({
        display: DISPLAY,
        visualization_settings: visualizationSettings,
      }),
      data: DATA,
    },
  ];
  return getCustomVizSettingValues(
    DISPLAY,
    MANIFEST,
    getComputedSettingsForSeries(series),
  );
}

describe("custom visualization settings", () => {
  beforeAll(() => {
    registerVisualization(
      createCustomVisualization({
        manifest: MANIFEST,
        displayName: "Heron ring",
        icon: null,
        definition: { mount: () => ({}) },
      }),
    );
  });

  afterAll(() => {
    visualizations.delete(DISPLAY);
  });

  it("registers each setting under the plugin's namespace with a widget", () => {
    const settings = visualizations.get(DISPLAY)?.settings ?? {};

    expect(settings).toMatchObject({
      "custom:heron-ring:goal": { title: "Goal", widget: "number" },
      "custom:heron-ring:label": { title: "Label", widget: "input" },
      "custom:heron-ring:shape": { title: "Shape", widget: "select" },
      "custom:heron-ring:showGoal": { title: "Show goal", widget: "toggle" },
      "custom:heron-ring:color": { title: "Color", widget: "color" },
      "custom:heron-ring:value": { title: "Value", widget: "field" },
      "custom:heron-ring:details": { title: "Details", widget: "multiselect" },
    });
    expect(settings).toHaveProperty("column_settings");
  });

  it("gives plugins their settings by id, with defaults", () => {
    expect(getPluginSettings()).toEqual({
      goal: 100,
      label: undefined,
      shape: "ring",
      showGoal: false,
      color: "#88BF4D",
      value: "count",
      details: ["species"],
    });
  });

  it("gives plugins the values stored for the question", () => {
    expect(
      getPluginSettings({
        "custom:heron-ring:goal": 250,
        "custom:heron-ring:label": "Herons spotted",
        "custom:heron-ring:shape": "bar",
        "custom:heron-ring:showGoal": true,
        "custom:heron-ring:value": "wingspan",
      }),
    ).toMatchObject({
      goal: 250,
      label: "Herons spotted",
      shape: "bar",
      showGoal: true,
      value: "wingspan",
    });
  });

  it("falls back to a valid column when the stored one is gone", () => {
    expect(
      getPluginSettings({
        "custom:heron-ring:value": "gone",
        "custom:heron-ring:details": ["gone"],
      }),
    ).toMatchObject({ value: "count", details: ["species"] });
  });
});
