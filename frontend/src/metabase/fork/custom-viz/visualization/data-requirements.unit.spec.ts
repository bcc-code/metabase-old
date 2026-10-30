import {
  createMockCategoryColumn,
  createMockColumn,
  createMockDatetimeColumn,
  createMockNumericColumn,
} from "metabase-types/api/mocks";

import {
  getCustomVizColumnType,
  getDataRequirementsProblem,
} from "./data-requirements";

const COUNT = createMockNumericColumn({ name: "count" });
const SPECIES = createMockCategoryColumn({ name: "species" });
const SPOTTED_AT = createMockDatetimeColumn({ name: "spotted_at" });
const IS_RARE = createMockColumn({
  name: "is_rare",
  base_type: "type/Boolean",
  effective_type: "type/Boolean",
});

describe("getCustomVizColumnType", () => {
  it.each([
    [COUNT, "number"],
    [SPECIES, "string"],
    [SPOTTED_AT, "date"],
    [IS_RARE, "boolean"],
    [createMockColumn({ base_type: "type/Structured" }), "other"],
  ])("classifies %o as %s", (column, columnType) => {
    expect(getCustomVizColumnType(column)).toBe(columnType);
  });
});

describe("getDataRequirementsProblem", () => {
  const data = {
    cols: [SPECIES, COUNT],
    rows: [
      ["Heron", 3],
      ["Egret", 5],
    ],
  };

  it("accepts any data without requirements", () => {
    expect(getDataRequirementsProblem(undefined, data)).toBeNull();
  });

  it("accepts data that meets the requirements", () => {
    expect(
      getDataRequirementsProblem(
        {
          minRows: 1,
          maxRows: 2,
          minColumns: 2,
          maxColumns: 2,
          requiredColumnTypes: { number: 1, string: 1 },
        },
        data,
      ),
    ).toBeNull();
  });

  it.each([
    [{ minRows: 3 }, "This visualization needs at least 3 rows of data."],
    [{ maxRows: 1 }, "This visualization can show at most 1 row of data."],
    [{ minColumns: 3 }, "This visualization needs at least 3 columns."],
    [{ maxColumns: 1 }, "This visualization can show at most 1 column."],
    [
      { requiredColumnTypes: { number: 2 } },
      "This visualization needs at least 2 number columns.",
    ],
    [
      { requiredColumnTypes: { date: 1 } },
      "This visualization needs at least 1 date column.",
    ],
    [
      { requiredColumnTypes: { boolean: 1 } },
      "This visualization needs at least 1 true/false column.",
    ],
  ])("explains why %o can't be met", (requirements, message) => {
    expect(getDataRequirementsProblem(requirements, data)).toBe(message);
  });
});
