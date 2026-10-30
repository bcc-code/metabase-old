import userEvent from "@testing-library/user-event";

import { renderWithProviders, screen, within } from "__support__/ui";
import type { Card } from "metabase-types/api";
import { createMockCard, createMockField } from "metabase-types/api/mocks";

import {
  type TargetOption,
  getQuestionTargetOptions,
  getTableTargetOptions,
} from "../../targets";

import { SandboxForm, type SandboxFormProps } from "./SandboxForm";

const TABLE_TARGETS = getTableTargetOptions([
  createMockField({ id: 1, display_name: "Category ID" }),
  createMockField({ id: 2, display_name: "Name" }),
]);

interface SetupOpts {
  initialSandbox?: SandboxFormProps["initialSandbox"];
  card?: Card;
  questionTargets?: TargetOption[];
  error?: string | null;
}

function setup({
  initialSandbox = null,
  card,
  questionTargets = [],
  error = null,
}: SetupOpts = {}) {
  const onSave = jest.fn<void, Parameters<SandboxFormProps["onSave"]>>();
  const onCancel = jest.fn<void, []>();
  const onCardChange = jest.fn<void, [number | null]>();

  renderWithProviders(
    <SandboxForm
      tableName="Venues"
      initialSandbox={initialSandbox}
      attributes={["region", "cat"]}
      tableTargets={TABLE_TARGETS}
      card={card}
      questionTargets={questionTargets}
      isSaving={false}
      error={error}
      onCardChange={onCardChange}
      onSave={onSave}
      onCancel={onCancel}
    />,
  );

  return { onSave, onCancel, onCardChange };
}

async function pickColumn(name: string) {
  await userEvent.click(screen.getByLabelText("Column of the table"));
  await userEvent.click(
    within(await screen.findByRole("listbox")).getByRole("option", { name }),
  );
}

describe("SandboxForm", () => {
  it("filters the table by a column matching a user attribute", async () => {
    const { onSave } = setup();
    const saveButton = screen.getByRole("button", { name: "Save" });

    expect(saveButton).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: /Add a filter/ }));
    expect(saveButton).toBeDisabled();

    await userEvent.type(screen.getByLabelText("User attribute"), "cat");
    await pickColumn("Category ID");
    expect(saveButton).toBeEnabled();

    await userEvent.click(saveButton);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      card_id: null,
      attribute_remappings: { cat: ["dimension", ["field", 1, null]] },
    });
  });

  it("shows and saves an existing policy", async () => {
    const { onSave } = setup({
      initialSandbox: {
        card_id: null,
        attribute_remappings: { region: ["dimension", ["field", 2, null]] },
      },
    });

    expect(screen.getByLabelText("User attribute")).toHaveValue("region");
    expect(screen.getByLabelText("Column of the table")).toHaveValue("Name");

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({
      card_id: null,
      attribute_remappings: { region: ["dimension", ["field", 2, null]] },
    });
  });

  it("can remove a filter", async () => {
    const { onSave } = setup({
      initialSandbox: {
        card_id: null,
        attribute_remappings: { region: ["dimension", ["field", 2, null]] },
      },
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Remove filter" }),
    );

    expect(screen.queryByLabelText("User attribute")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("restricts the table to a saved question, optionally passing it attributes", async () => {
    const card = createMockCard({
      id: 5,
      name: "Venues in my region",
      parameters: [],
      result_metadata: [
        createMockField({ id: 1, display_name: "Category ID" }),
      ],
    });
    const { onSave } = setup({
      initialSandbox: { card_id: 5, attribute_remappings: {} },
      card,
      questionTargets: getQuestionTargetOptions(card),
    });

    expect(screen.getByText("Venues in my region")).toBeInTheDocument();
    expect(
      screen.getByRole("radio", {
        name: /Use a saved question to create a custom view/,
      }),
    ).toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({
      card_id: 5,
      attribute_remappings: {},
    });
  });

  it("forgets the question when switching back to filtering the table", async () => {
    const { onCardChange } = setup({
      initialSandbox: { card_id: 5, attribute_remappings: {} },
    });

    await userEvent.click(
      screen.getByRole("radio", { name: /Filter by a column in the table/ }),
    );

    expect(onCardChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows why the policy was refused", () => {
    setup({ error: 'Column "PRICE" is not a column of table "Venues".' });

    expect(screen.getByRole("alert")).toHaveTextContent(
      'Column "PRICE" is not a column of table "Venues".',
    );
  });
});
