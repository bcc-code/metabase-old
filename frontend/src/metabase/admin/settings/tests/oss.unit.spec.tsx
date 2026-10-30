import { screen } from "__support__/ui";

import {
  setup as baseSetup,
  ossRoutes,
  premiumRoutes,
  routeObjtoArray,
} from "./setup";

const setup = async ({ isAdmin = true, initialRoute = "" } = {}) => {
  return baseSetup({
    enterprisePlugins: undefined,
    hasTokenFeatures: false,
    isAdmin,
    initialRoute,
  });
};

const routes = routeObjtoArray(ossRoutes);
const notFoundRoutes = routeObjtoArray(premiumRoutes);

describe("Admin Settings Routing - OSS", () => {
  it("renders the settings editor", async () => {
    await setup({ isAdmin: true });
    expect(
      await screen.findByTestId("admin-layout-content"),
    ).toBeInTheDocument();
  });

  describe("renders the OSS routes", () => {
    it.each(routes)(
      "renders the $name route",
      async ({ path, testPattern }) => {
        await setup({ isAdmin: true, initialRoute: path });
        expect(await screen.findByText(testPattern)).toBeInTheDocument();
      },
    );
  });

  describe("does not render pages that only advertise paid plans", () => {
    it.each(["/license", "/cloud"])(
      "renders not found on %s",
      async (initialRoute) => {
        await setup({ isAdmin: true, initialRoute });
        expect(
          await screen.findByText("We're a little lost..."),
        ).toBeInTheDocument();
        expect(
          screen.queryByText("Explore our paid plans"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByText("Migrate to Metabase Cloud"),
        ).not.toBeInTheDocument();
      },
    );
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
