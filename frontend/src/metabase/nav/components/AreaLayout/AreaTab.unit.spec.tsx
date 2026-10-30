import type { ReactNode } from "react";

import { renderWithProviders, screen } from "__support__/ui";
import { Route } from "metabase/router";

import { AreaTab } from "./AreaTab";

interface SetupOpts {
  isSelected?: boolean;
  rightSection?: ReactNode;
}

const setup = ({ isSelected = false, rightSection }: SetupOpts = {}) => {
  renderWithProviders(
    <Route
      path="/"
      element={
        <AreaTab
          label="Dependency diagnostics"
          icon="search_check"
          to="/monitor/dependency-diagnostics"
          isSelected={isSelected}
          rightSection={rightSection}
          showLabel
        />
      }
    />,
    { withRouter: true },
  );
};

describe("AreaTab", () => {
  it("marks the selected tab as the current page for assistive tech", () => {
    setup({ isSelected: true });

    const tab = screen.getByRole("link", { name: "Dependency diagnostics" });
    expect(tab).toHaveAttribute("aria-current", "page");
  });

  it("does not mark an unselected tab as current", () => {
    setup({ isSelected: false });

    const tab = screen.getByRole("link", { name: "Dependency diagnostics" });
    expect(tab).not.toHaveAttribute("aria-current");
  });

  it("does not show an upsell gem", () => {
    setup();

    expect(screen.queryByTestId("upsell-gem")).not.toBeInTheDocument();
  });

  it("shows a custom right section", () => {
    setup({
      rightSection: <span data-testid="custom-right-section" />,
    });

    expect(screen.getByTestId("custom-right-section")).toBeInTheDocument();
  });
});
