import { screen, waitFor, within } from "__support__/ui";

import {
  setup as baseSetup,
  ossRoutes,
  premiumRoutes,
  routeObjtoArray,
} from "./setup";

const setup = async ({ isAdmin = true, initialRoute = "" } = {}) => {
  await baseSetup({
    hasTokenFeatures: false,
    isAdmin,
    initialRoute,
    enterprisePlugins: "*", // means all enterprise plugins
  });
};

const routes = routeObjtoArray(ossRoutes);

const notFoundRoutes = routeObjtoArray(premiumRoutes);

describe("Admin Settings Routing - Enterprise without features", () => {
  it("renders the settings editor", async () => {
    await setup({ isAdmin: true });
    expect(
      await screen.findByTestId("admin-layout-content"),
    ).toBeInTheDocument();
  });

  describe("renders the common routes", () => {
    it.each(routes)(
      "renders the $name route",
      async ({ path, testPattern, role }) => {
        await setup({ isAdmin: true, initialRoute: path });
        await waitFor(() => {
          expect(
            role
              ? screen.getByRole(role, { name: testPattern })
              : screen.getByText(testPattern),
          ).toBeInTheDocument();
        });
      },
    );
  });

  it("should not offer a custom URL landing page without the whitelabel feature", async () => {
    await setup({ isAdmin: true, initialRoute: "/general" });

    const homepageSetting = await screen.findByTestId("homepage-setting");
    expect(
      within(homepageSetting).getByRole("radio", {
        name: "Default Metabase home",
      }),
    ).toBeInTheDocument();
    expect(
      within(homepageSetting).queryByRole("radio", { name: "Custom URL" }),
    ).not.toBeInTheDocument();
  });

  describe("does not render the premium routes", () => {
    it.each(notFoundRoutes)(
      "should not find the $name enterprise route",
      async ({ path, testPattern }) => {
        await setup({ isAdmin: true, initialRoute: path });
        expect(screen.queryByText(testPattern)).not.toBeInTheDocument();
      },
    );
  });
});
