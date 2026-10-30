import userEvent from "@testing-library/user-event";

import { renderWithProviders, screen } from "__support__/ui";

import { ImpersonationForm } from "./ImpersonationForm";

interface SetupOpts {
  initialAttribute?: string | null;
  requiresDefaultRole?: boolean;
  attributes?: string[];
}

function setup({
  initialAttribute = null,
  requiresDefaultRole = false,
  attributes = ["db_role", "region"],
}: SetupOpts = {}) {
  const onSave = jest.fn<void, [string]>();
  const onCancel = jest.fn<void, []>();

  renderWithProviders(
    <ImpersonationForm
      databaseName="Warehouse"
      requiresDefaultRole={requiresDefaultRole}
      initialAttribute={initialAttribute}
      attributes={attributes}
      onSave={onSave}
      onCancel={onCancel}
    />,
  );

  return { onSave, onCancel };
}

describe("ImpersonationForm", () => {
  it("saves the attribute holding the database role", async () => {
    const { onSave } = setup();
    const saveButton = screen.getByRole("button", { name: "Save" });

    expect(saveButton).toBeDisabled();

    await userEvent.type(
      screen.getByLabelText("User attribute holding the database role"),
      " db_role ",
    );
    await userEvent.click(saveButton);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("db_role");
  });

  it("starts from the existing policy", () => {
    setup({ initialAttribute: "region" });

    expect(
      screen.getByLabelText("User attribute holding the database role"),
    ).toHaveValue("region");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("warns when the database needs a default role", () => {
    setup({ requiresDefaultRole: true });

    expect(screen.getByText(/needs a default role/)).toBeInTheDocument();
  });

  it("explains where attributes come from when there are none", () => {
    setup({ attributes: [] });

    expect(screen.getByText(/No user has attributes yet/)).toBeInTheDocument();
  });

  it("can be cancelled", async () => {
    const { onCancel, onSave } = setup();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});
