import userEvent from "@testing-library/user-event";
import fetchMock from "fetch-mock";

import {
  setupInvalidateCacheEndpoint,
  setupPerformanceEndpoints,
} from "__support__/server-mocks";
import { renderWithProviders, screen, waitFor, within } from "__support__/ui";
import { Route } from "metabase/router";
import type { CacheConfigWithDetails } from "metabase-types/api";
import {
  createMockCacheConfig,
  createMockCacheConfigWithDurationStrategy,
  createMockCollection,
} from "metabase-types/api/mocks";

import { initializeCachingPlugin } from "../..";

import { StrategyEditorForQuestionsAndDashboards } from "./QuestionsAndDashboardsCaching";

const dashboardConfig: CacheConfigWithDetails = {
  ...createMockCacheConfigWithDurationStrategy({
    model: "dashboard",
    model_id: 3,
  }),
  name: "Sales overview",
  collection: createMockCollection({ id: 7, name: "Sales" }),
};

const questionConfig: CacheConfigWithDetails = {
  ...createMockCacheConfig({
    model: "question",
    model_id: 3,
    strategy: { type: "nocache" },
  }),
  name: "Orders",
  collection: null,
};

interface SetupOpts {
  cacheConfigs?: CacheConfigWithDetails[];
}

const setup = ({
  cacheConfigs = [dashboardConfig, questionConfig],
}: SetupOpts = {}) => {
  initializeCachingPlugin();
  setupPerformanceEndpoints(cacheConfigs);
  setupInvalidateCacheEndpoint();
  renderWithProviders(
    <Route path="*" element={<StrategyEditorForQuestionsAndDashboards />} />,
    { withRouter: true },
  );
};

const getRowWithLink = (name: RegExp) =>
  screen
    .getAllByRole("row")
    .find((row) => within(row).queryByRole("link", { name }));

describe("StrategyEditorForQuestionsAndDashboards", () => {
  it("lists the dashboards and questions with their own policy", async () => {
    setup();
    const table = await screen.findByTestId("cache-config-table");
    const dashboardRow = getRowWithLink(/Sales overview/);
    const questionRow = getRowWithLink(/Orders/);
    expect(dashboardRow).toHaveTextContent("Sales");
    expect(dashboardRow).toHaveTextContent("Duration: 1h");
    expect(questionRow).toHaveTextContent("Our analytics");
    expect(questionRow).toHaveTextContent("No caching");
    expect(
      within(table).getByRole("link", { name: /Sales overview/ }),
    ).toHaveAttribute("href", "/dashboard/3-sales-overview");
    expect(within(table).getByRole("link", { name: /Orders/ })).toHaveAttribute(
      "href",
      "/question/3-orders",
    );
  });

  it("asks the API for one sorted page of dashboards and questions", async () => {
    setup();
    await screen.findByTestId("cache-config-table");
    const url = new URL(
      String(fetchMock.callHistory.lastCall("path:/api/cache")?.url),
    );
    expect(url.searchParams.getAll("model")).toEqual(["dashboard", "question"]);
    expect(url.searchParams.get("sort_column")).toBe("name");
    expect(url.searchParams.get("sort_direction")).toBe("asc");
    expect(url.searchParams.get("limit")).toBe("25");
    expect(url.searchParams.get("offset")).toBe("0");

    await userEvent.click(screen.getByText("Policy"));
    await waitFor(() => {
      const sortedUrl = new URL(
        String(fetchMock.callHistory.lastCall("path:/api/cache")?.url),
      );
      expect(sortedUrl.searchParams.get("sort_column")).toBe("policy");
    });
  });

  it("explains when nothing has its own policy", async () => {
    setup({ cacheConfigs: [] });
    expect(
      await screen.findByText(
        "No dashboards or questions have their own caching policy yet",
      ),
    ).toBeInTheDocument();
  });

  it("edits the policy of a dashboard in a sidesheet", async () => {
    setup();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Edit the policy of Sales overview, currently Duration: 1h",
      }),
    );
    const sidesheet = await screen.findByRole("dialog", {
      name: /Caching settings/,
    });
    expect(
      await within(sidesheet).findByTestId("strategy-form-for-dashboard-3"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(sidesheet).getByTestId("cache-strategy-select"),
      ).toHaveValue("Duration"),
    );
  });

  it("resets a question to the default policy", async () => {
    setup();
    await userEvent.click(
      await screen.findByRole("button", { name: "More options for Orders" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /Reset to default/ }),
    );
    await userEvent.click(
      within(await screen.findByTestId("confirm-modal")).getByRole("button", {
        name: "Reset",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: /Orders/ }),
      ).not.toBeInTheDocument(),
    );
    const call = fetchMock.callHistory.lastCall("path:/api/cache", {
      method: "DELETE",
    });
    const body: unknown = JSON.parse(String(await call?.request?.text()));
    expect(body).toEqual({ model: "question", model_id: 3 });
    expect(
      screen.getByRole("link", { name: /Sales overview/ }),
    ).toBeInTheDocument();
  });
});
