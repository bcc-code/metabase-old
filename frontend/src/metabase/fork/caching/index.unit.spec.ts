import { PLUGIN_CACHING, reinitialize } from "metabase/plugins";
import Question from "metabase-lib/v1/Question";
import { createMockCard } from "metabase-types/api/mocks";

import { initializeCachingPlugin } from ".";

const getValidationSchema = (strategyType: string) => {
  const { validationSchema } = PLUGIN_CACHING.strategies[strategyType];
  return typeof validationSchema === "function"
    ? validationSchema()
    : validationSchema;
};

describe("initializeCachingPlugin", () => {
  beforeEach(() => {
    initializeCachingPlugin();
  });

  afterEach(() => {
    reinitialize();
  });

  it("turns granular caching on", () => {
    expect(PLUGIN_CACHING.isGranularCachingEnabled()).toBe(true);
    expect(PLUGIN_CACHING.canOverrideRootStrategy).toBe(true);
  });

  it("offers every strategy", () => {
    expect(Object.keys(PLUGIN_CACHING.strategies)).toEqual([
      "inherit",
      "ttl",
      "duration",
      "schedule",
      "nocache",
    ]);
  });

  it("requires a positive whole duration, in hours by default", () => {
    const schema = getValidationSchema("duration");
    expect(schema.isValidSync({ type: "duration", duration: 0 })).toBe(false);
    expect(schema.isValidSync({ type: "duration", duration: 1.5 })).toBe(false);
    expect(schema.validateSync({ type: "duration", duration: 3 })).toEqual({
      type: "duration",
      duration: 3,
      unit: "hours",
      refresh_automatically: false,
    });
  });

  it("invalidates hourly by default on a schedule", () => {
    expect(
      getValidationSchema("schedule").validateSync({ type: "schedule" }),
    ).toEqual({
      type: "schedule",
      schedule: "0 0 * * * ? *",
      refresh_automatically: false,
    });
  });

  it("adds the tab for dashboard and question policies", () => {
    expect(PLUGIN_CACHING.getTabMetadata().map(({ tabId }) => tabId)).toEqual([
      "databases",
      "dashboards-and-questions",
      "models",
    ]);
  });

  it.each([
    ["a saved question the user can edit", {}, true],
    ["a saved metric the user can edit", { type: "metric" as const }, true],
    ["a model, which is persisted instead", { type: "model" as const }, false],
    ["a question the user can't edit", { can_write: false }, false],
    ["an archived question", { archived: true }, false],
  ])("decides whether %s has its own caching section", (_, card, expected) => {
    const question = new Question(createMockCard({ can_write: true, ...card }));
    expect(PLUGIN_CACHING.hasQuestionCacheSection(question)).toBe(expected);
  });
});
