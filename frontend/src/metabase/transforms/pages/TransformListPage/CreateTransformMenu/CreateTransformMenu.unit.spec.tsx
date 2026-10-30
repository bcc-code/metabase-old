import userEvent from "@testing-library/user-event";

import { setupDatabasesEndpoints } from "__support__/server-mocks";
import { mockSettings } from "__support__/settings";
import { createMockState } from "__support__/state";
import { renderWithProviders, screen } from "__support__/ui";
import type { TokenFeatures } from "metabase-types/api";
import {
  createMockDatabase,
  createMockTokenFeatures,
} from "metabase-types/api/mocks";

import { CreateTransformMenu } from "./CreateTransformMenu";

type SetupOpts = {
  tokenFeatures?: Partial<TokenFeatures>;
};

const setup = async ({ tokenFeatures = {} }: SetupOpts = {}) => {
  setupDatabasesEndpoints([createMockDatabase()]);
  renderWithProviders(<CreateTransformMenu />, {
    withRouter: true,
    storeInitialState: createMockState({
      settings: mockSettings({
        "token-features": createMockTokenFeatures(tokenFeatures),
      }),
    }),
  });

  await userEvent.click(
    await screen.findByRole("button", { name: "Create a transform" }),
  );
};

describe("CreateTransformMenu", () => {
  it("shows the SQL query item", async () => {
    await setup();

    expect(await screen.findByText("SQL query")).toBeInTheDocument();
  });

  it.each([
    { name: "OSS", tokenFeatures: {} },
    { name: "a paid plan", tokenFeatures: { advanced_permissions: true } },
  ])(
    "does not offer Python scripts without the transforms-python feature on $name",
    async ({ tokenFeatures }) => {
      await setup({ tokenFeatures });

      expect(await screen.findByText("SQL query")).toBeInTheDocument();
      expect(screen.queryByText("Python script")).not.toBeInTheDocument();
      expect(screen.queryByTestId("upsell-gem")).not.toBeInTheDocument();
    },
  );

  it("offers Python scripts with the transforms-python feature", async () => {
    await setup({ tokenFeatures: { "transforms-python": true } });

    expect(await screen.findByText("Python script")).toBeInTheDocument();
    expect(screen.queryByTestId("upsell-gem")).not.toBeInTheDocument();
  });
});
