import { screen, waitFor, within } from "__support__/ui";

import {
  setup as baseSetup,
  ossRoutes,
  premiumRoutes,
  routeObjtoArray,
  whitelabelRoutes,
} from "./setup";

const setup = async ({
  isAdmin = true,
  initialRoute = "",
  features = {},
} = {}) => {
  await baseSetup({
    hasTokenFeatures: true,
    isAdmin,
    features,
    initialRoute,
    enterprisePlugins: "*", // means all enterprise plugins
  });
};

const routes = routeObjtoArray({
  ...ossRoutes,
  ...premiumRoutes,
  ...whitelabelRoutes,
  // this suite enables all features (incl. remote_sync), so the remote sync settings UI renders
  remoteSync: { path: "/remote-sync", testPattern: /Set up remote sync/i },
});

describe("Admin Settings Routing - Enterprise with all features", () => {
  it("renders the settings editor", async () => {
    await setup({ isAdmin: true });
    expect(
      await screen.findByTestId("admin-layout-content"),
    ).toBeInTheDocument();
  });

  describe("renders all the routes", () => {
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

  it.each([
    { route: "/license", hosting: false },
    { route: "/cloud", hosting: false },
    { route: "/cloud", hosting: true },
  ])(
    "should render not found on $route (hosting: $hosting)",
    async ({ route, hosting }) => {
      await setup({ initialRoute: route, features: { hosting } });
      expect(
        await screen.findByText("We're a little lost..."),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Migrate to Metabase Cloud"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Cloud settings")).not.toBeInTheDocument();
    },
  );

  it("should offer a custom URL landing page with the whitelabel feature", async () => {
    await setup({ isAdmin: true, initialRoute: "/general" });

    const homepageSetting = await screen.findByTestId("homepage-setting");
    expect(
      within(homepageSetting).getByRole("radio", { name: "Custom URL" }),
    ).toBeInTheDocument();
  });
});
