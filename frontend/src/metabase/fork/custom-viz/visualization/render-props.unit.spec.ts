import type { ComputedVisualizationSettings } from "metabase/viz-core";
import {
  createMockCard,
  createMockCategoryColumn,
  createMockDatasetData,
  createMockNumericColumn,
} from "metabase-types/api/mocks";

import {
  DEFAULT_CUSTOM_VIZ_ICON,
  formatColumnValue,
  getCustomVizClickObject,
  getCustomVizIconName,
  toCustomVizColumn,
} from "./render-props";

const SPECIES = createMockCategoryColumn({
  name: "species",
  display_name: "Species",
  source: "breakout",
});
const COUNT = createMockNumericColumn({
  name: "count",
  display_name: "Count",
  source: "aggregation",
});
const DATA = createMockDatasetData({
  cols: [SPECIES, COUNT],
  rows: [
    ["Heron", 3],
    ["Egret", 1234],
  ],
});
const SERIES = [
  { card: createMockCard({ display: "custom:herons" }), data: DATA },
];
const SETTINGS: ComputedVisualizationSettings = {};

describe("toCustomVizColumn", () => {
  it("describes a column in the plugin contract's terms", () => {
    expect(toCustomVizColumn(COUNT)).toEqual({
      name: "count",
      displayName: "Count",
      type: "number",
      baseType: "type/Integer",
      semanticType: null,
    });
  });
});

describe("getCustomVizIconName", () => {
  it("keeps a Metabase icon name", () => {
    expect(getCustomVizIconName("pie")).toBe("pie");
  });

  it.each([null, undefined, "not-an-icon"])(
    "falls back to a chart icon for %s",
    (icon) => {
      expect(getCustomVizIconName(icon)).toBe(DEFAULT_CUSTOM_VIZ_ICON);
    },
  );
});

describe("formatColumnValue", () => {
  it("formats a value the way its column is formatted", () => {
    expect(formatColumnValue(1234, "count", DATA.cols, SETTINGS)).toBe("1,234");
  });

  it("falls back to the plain value for an unknown column", () => {
    expect(formatColumnValue(1234, "wingspan", DATA.cols, SETTINGS)).toBe(
      "1234",
    );
  });
});

describe("getCustomVizClickObject", () => {
  it("builds a cell click with the row's breakout values as dimensions", () => {
    const event = new MouseEvent("click");

    expect(
      getCustomVizClickObject(SERIES, SETTINGS, {
        rowIndex: 1,
        columnName: "count",
        event,
      }),
    ).toMatchObject({
      value: 1234,
      column: COUNT,
      dimensions: [{ column: SPECIES, value: "Egret" }],
      data: [
        { col: SPECIES, value: "Egret" },
        { col: COUNT, value: 1234 },
      ],
      event,
    });
  });

  it("ignores what plugins pass that isn't a MouseEvent or an Element", () => {
    expect(
      getCustomVizClickObject(SERIES, SETTINGS, {
        rowIndex: 0,
        columnName: "species",
        event: "click",
        element: {},
      }),
    ).toMatchObject({ value: "Heron", event: undefined, element: undefined });
  });

  it.each([
    null,
    { rowIndex: 0 },
    { rowIndex: 0.5, columnName: "count" },
    { rowIndex: 9, columnName: "count" },
    { rowIndex: 0, columnName: "wingspan" },
  ])("returns null for a click that names no cell: %o", (click) => {
    expect(getCustomVizClickObject(SERIES, SETTINGS, click)).toBeNull();
  });
});
