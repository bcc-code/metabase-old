import { getBrokenUpTextMatcher, screen } from "__support__/ui";

import { setup } from "./setup";

describe("Static Embed Setup phase - EE, no token", () => {
  describe.each([
    {
      resourceType: "dashboard" as const,
    },
    {
      resourceType: "question" as const,
    },
  ])("$resourceType", ({ resourceType }) => {
    describe("Look and Feel tab", () => {
      it("should not render Font selector", async () => {
        await setup({
          props: {
            resourceType,
          },
          activeTab: "Look and Feel",
          enterprisePlugins: ["whitelabel"],
        });

        expect(
          screen.getByText("Customizing look and feel"),
        ).toBeInTheDocument();
        expect(screen.queryByText("Font")).not.toBeInTheDocument();
        expect(
          screen.queryByText(
            getBrokenUpTextMatcher("You can change the font with a paid plan."),
          ),
        ).not.toBeInTheDocument();
      });

      it("should not advertise removing the banner", async () => {
        await setup({
          props: {},
          activeTab: "Look and Feel",
          enterprisePlugins: ["whitelabel"],
        });

        expect(
          screen.getByText("Customizing look and feel"),
        ).toBeInTheDocument();
        expect(
          screen.queryByText("Removing the banner"),
        ).not.toBeInTheDocument();
      });
    });
  });
});
