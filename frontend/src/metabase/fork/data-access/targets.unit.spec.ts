import {
  createMockCard,
  createMockField,
  createMockParameter,
} from "metabase-types/api/mocks";

import {
  getQuestionTargetOptions,
  getTableTargetOptions,
  getTargetKey,
} from "./targets";

describe("getTableTargetOptions", () => {
  it("offers each column of the table, by its field ID", () => {
    const options = getTableTargetOptions([
      createMockField({ id: 1, display_name: "Category ID" }),
      createMockField({ id: 2, display_name: "Name" }),
    ]);

    expect(options).toEqual([
      {
        key: getTargetKey(["dimension", ["field", 1, null]]),
        label: "Category ID",
        target: ["dimension", ["field", 1, null]],
      },
      {
        key: getTargetKey(["dimension", ["field", 2, null]]),
        label: "Name",
        target: ["dimension", ["field", 2, null]],
      },
    ]);
  });
});

describe("getQuestionTargetOptions", () => {
  it("offers the variables of a native question, then its columns", () => {
    const card = createMockCard({
      parameters: [
        createMockParameter({
          id: "cat",
          name: "Category",
          slug: "cat",
          target: ["variable", ["template-tag", "cat"]],
        }),
      ],
      result_metadata: [
        createMockField({
          id: ["field", "CATEGORY_ID", { "base-type": "type/Integer" }],
          name: "CATEGORY_ID",
          display_name: "Category ID",
          base_type: "type/Integer",
        }),
      ],
    });

    expect(getQuestionTargetOptions(card)).toEqual([
      {
        key: getTargetKey(["variable", ["template-tag", "cat"]]),
        label: "Category",
        target: ["variable", ["template-tag", "cat"]],
      },
      {
        key: getTargetKey([
          "dimension",
          ["field", "CATEGORY_ID", { "base-type": "type/Integer" }],
        ]),
        label: "Category ID",
        target: [
          "dimension",
          ["field", "CATEGORY_ID", { "base-type": "type/Integer" }],
        ],
      },
    ]);
  });

  it("references a column of an MBQL question by its field ID", () => {
    const card = createMockCard({
      parameters: [],
      result_metadata: [createMockField({ id: 7, display_name: "Price" })],
    });

    expect(getQuestionTargetOptions(card)).toEqual([
      {
        key: getTargetKey(["dimension", ["field", 7, null]]),
        label: "Price",
        target: ["dimension", ["field", 7, null]],
      },
    ]);
  });
});
