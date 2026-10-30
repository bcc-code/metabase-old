import userEvent from "@testing-library/user-event";

import { setupUserEndpoints } from "__support__/server-mocks";
import { renderWithProviders, screen, waitFor } from "__support__/ui";
import { Form, FormProvider, FormSubmitButton } from "metabase/forms";
import type {
  StructuredUserAttributes,
  UserAttributeMap,
} from "metabase-types/api";
import { createMockUserListResult } from "metabase-types/api/mocks";

import { UserAttributesField, getSsoAttributes } from "./UserAttributesField";

interface FormValues {
  login_attributes: UserAttributeMap;
}

interface SetupOpts {
  loginAttributes?: UserAttributeMap;
  structuredAttributes?: StructuredUserAttributes;
}

function setup({ loginAttributes = {}, structuredAttributes }: SetupOpts = {}) {
  const onSubmit = jest.fn<void, [FormValues]>();
  const userId = 7;
  if (structuredAttributes) {
    setupUserEndpoints(
      createMockUserListResult({
        id: userId,
        structured_attributes: structuredAttributes,
      }),
    );
  }

  renderWithProviders(
    <FormProvider<FormValues>
      initialValues={{ login_attributes: loginAttributes }}
      onSubmit={onSubmit}
    >
      <Form>
        <UserAttributesField userId={structuredAttributes ? userId : null} />
        <FormSubmitButton label="Submit" />
      </Form>
    </FormProvider>,
  );

  return { onSubmit };
}

const submittedAttributes = (onSubmit: jest.Mock<void, [FormValues]>) =>
  onSubmit.mock.calls[0][0].login_attributes;

describe("UserAttributesField", () => {
  it("edits, adds and removes the attributes an admin sets", async () => {
    const { onSubmit } = setup({
      loginAttributes: { region: "eu", team: "data" },
    });

    const [regionValue] = screen.getAllByLabelText("Attribute value");
    await userEvent.clear(regionValue);
    await userEvent.type(regionValue, "us");

    await userEvent.click(
      screen.getAllByRole("button", { name: "Remove attribute" })[1],
    );

    await userEvent.click(
      screen.getByRole("button", { name: /Add an attribute/ }),
    );
    const names = screen.getAllByLabelText("Attribute name");
    const values = screen.getAllByLabelText("Attribute value");
    await userEvent.type(names[names.length - 1], "db_role");
    await userEvent.type(values[values.length - 1], "analyst");

    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(submittedAttributes(onSubmit)).toEqual({
      region: "us",
      db_role: "analyst",
    });
  });

  it("leaves out attributes without a name", async () => {
    const { onSubmit } = setup({ loginAttributes: { region: "eu" } });

    await userEvent.click(
      screen.getByRole("button", { name: /Add an attribute/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(submittedAttributes(onSubmit)).toEqual({ region: "eu" });
  });

  it("warns about duplicate names", async () => {
    setup({ loginAttributes: { region: "eu" } });

    await userEvent.click(
      screen.getByRole("button", { name: /Add an attribute/ }),
    );
    const names = screen.getAllByLabelText("Attribute name");
    await userEvent.type(names[names.length - 1], "region");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Each attribute name can only be used once",
    );
  });

  it("lists the attributes the identity provider sent, and those overridden here", async () => {
    setup({
      loginAttributes: { region: "eu" },
      structuredAttributes: {
        department: { source: "jwt", frozen: false, value: "finance" },
        region: {
          source: "user",
          frozen: false,
          value: "eu",
          original: { source: "jwt", frozen: false, value: "us" },
        },
      },
    });

    expect(
      await screen.findByText("From the identity provider"),
    ).toBeInTheDocument();
    expect(screen.getByText("department: finance")).toBeInTheDocument();
    expect(
      screen.getByText("region: us (overridden below)"),
    ).toBeInTheDocument();
  });
});

describe("getSsoAttributes", () => {
  it("returns the identity provider's attributes, including overridden ones", () => {
    expect(
      getSsoAttributes({
        department: { source: "jwt", frozen: false, value: "finance" },
        team: { source: "user", frozen: false, value: "data" },
        region: {
          source: "user",
          frozen: false,
          value: "eu",
          original: { source: "jwt", frozen: false, value: "us" },
        },
      }),
    ).toEqual([
      ["department", "finance"],
      ["region", "us"],
    ]);
  });
});
