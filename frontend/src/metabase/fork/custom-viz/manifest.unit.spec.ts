import { parseCustomVizManifest } from "./manifest";

const MANIFEST = {
  apiVersion: 1,
  identifier: "heron-ring",
  name: "Heron ring",
  icon: "progress",
  data: { minRows: 1, maxRows: 1, requiredColumnTypes: { number: 1 } },
  settings: [
    { id: "goal", type: "number", title: "Goal", default: 100 },
    { id: "label", type: "text", title: "Label", placeholder: "Herons" },
    {
      id: "shape",
      type: "select",
      title: "Shape",
      options: [
        { name: "Ring", value: "ring" },
        { name: "Bar", value: "bar" },
      ],
      default: "bar",
    },
    { id: "showGoal", type: "toggle", title: "Show goal", default: true },
    { id: "color", type: "color", title: "Color" },
    { id: "value", type: "column", title: "Value", columnType: "number" },
    { id: "details", type: "columns", title: "Details" },
  ],
};

describe("parseCustomVizManifest", () => {
  it("returns a valid manifest", () => {
    expect(parseCustomVizManifest(MANIFEST)).toEqual({
      apiVersion: 1,
      identifier: "heron-ring",
      name: "Heron ring",
      icon: "progress",
      description: undefined,
      data: {
        minRows: 1,
        maxRows: 1,
        minColumns: undefined,
        maxColumns: undefined,
        requiredColumnTypes: { number: 1 },
      },
      settings: [
        {
          id: "goal",
          type: "number",
          title: "Goal",
          section: undefined,
          default: 100,
          placeholder: undefined,
        },
        {
          id: "label",
          type: "text",
          title: "Label",
          section: undefined,
          default: undefined,
          placeholder: "Herons",
        },
        {
          id: "shape",
          type: "select",
          title: "Shape",
          section: undefined,
          options: [
            { name: "Ring", value: "ring" },
            { name: "Bar", value: "bar" },
          ],
          default: "bar",
        },
        {
          id: "showGoal",
          type: "toggle",
          title: "Show goal",
          section: undefined,
          default: true,
        },
        {
          id: "color",
          type: "color",
          title: "Color",
          section: undefined,
          default: undefined,
        },
        {
          id: "value",
          type: "column",
          title: "Value",
          section: undefined,
          columnType: "number",
        },
        {
          id: "details",
          type: "columns",
          title: "Details",
          section: undefined,
          columnType: "any",
        },
      ],
    });
  });

  it("accepts a manifest without data requirements or settings", () => {
    expect(
      parseCustomVizManifest({
        apiVersion: 1,
        identifier: "egret",
        name: "Egret",
      }),
    ).toMatchObject({
      identifier: "egret",
      data: undefined,
      settings: undefined,
    });
  });

  it.each([
    [null, "The manifest is missing."],
    [
      { ...MANIFEST, apiVersion: 2 },
      "The bundle needs custom visualization API version 2, but only version 1 is supported.",
    ],
    [
      { ...MANIFEST, identifier: "Heron Ring" },
      "The manifest has an invalid identifier.",
    ],
    [{ ...MANIFEST, name: " " }, "The manifest needs a name."],
    [
      { ...MANIFEST, settings: { goal: {} } },
      "The manifest's settings must be a list.",
    ],
    [
      { ...MANIFEST, settings: [{ id: "x", type: "slider", title: "X" }] },
      'The setting "x" has an unknown type: slider.',
    ],
    [
      { ...MANIFEST, settings: [{ id: "x", type: "select", title: "X" }] },
      "A select setting needs a list of options.",
    ],
    [
      { ...MANIFEST, settings: [{ id: "x", type: "text" }] },
      'The setting "x" needs a title.',
    ],
  ])("rejects an invalid manifest (%#)", (manifest, message) => {
    expect(() => parseCustomVizManifest(manifest)).toThrow(message);
  });
});
