import fetchMock from "fetch-mock";

import { renderWithProviders, screen } from "__support__/ui";
import { createMockUser } from "metabase-types/api/mocks";

import { EmbeddingThemeListingApp } from "./EmbeddingThemeListingApp";

const setup = () => {
  fetchMock.get("path:/api/embed-theme", []);

  renderWithProviders(
    <EmbeddingThemeListingApp basePath="/embedding/appearance/theme" />,
    {
      storeInitialState: {
        currentUser: createMockUser({ is_superuser: true }),
      },
    },
  );
};

/**
 * The component does not check `embedding_simple` -- its caller gates it.
 */
describe("EmbeddingThemeListingApp", () => {
  it("renders the themes listing", async () => {
    setup();

    expect(
      await screen.findByRole("button", { name: /New theme/ }),
    ).toBeInTheDocument();
  });

  it("leaves the heading to the host page", async () => {
    setup();

    expect(
      await screen.findByRole("button", { name: /New theme/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Themes" }),
    ).not.toBeInTheDocument();
  });
});
