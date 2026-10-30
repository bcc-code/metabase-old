import userEvent from "@testing-library/user-event";
import fetchMock from "fetch-mock";

import {
  setupDatabasesEndpoints,
  setupInvalidateCacheEndpoint,
  setupPerformanceEndpoints,
} from "__support__/server-mocks";
import { renderWithProviders, screen, waitFor, within } from "__support__/ui";
import { StrategyEditorForDatabases } from "metabase/admin/performance/components/StrategyEditorForDatabases";
import { Route } from "metabase/router";
import type { CacheConfig } from "metabase-types/api";
import { CacheDurationUnit } from "metabase-types/api";
import {
  createMockCacheConfig,
  createMockCacheConfigWithDurationStrategy,
} from "metabase-types/api/mocks";
import { createSampleDatabase } from "metabase-types/api/mocks/presets";

import { initializeCachingPlugin } from "../..";

interface SetupOpts {
  cacheConfigs?: CacheConfig[];
}

const rootAdaptive = createMockCacheConfig({
  model: "root",
  model_id: 0,
  strategy: { type: "ttl", multiplier: 10, min_duration_ms: 1000 },
});

const setup = ({ cacheConfigs = [rootAdaptive] }: SetupOpts = {}) => {
  initializeCachingPlugin();
  setupPerformanceEndpoints(cacheConfigs);
  setupInvalidateCacheEndpoint();
  setupDatabasesEndpoints([
    createSampleDatabase({ id: 1, name: "Sales", tables: [] }),
    createSampleDatabase({ id: 2, name: "Warehouse", tables: [] }),
  ]);
  renderWithProviders(
    <Route path="*" element={<StrategyEditorForDatabases />} />,
    { withRouter: true },
  );
};

const lastRequestBody = async (method: "PUT" | "DELETE") => {
  const call = fetchMock.callHistory.lastCall("path:/api/cache", { method });
  const body: unknown = JSON.parse(String(await call?.request?.text()));
  return body;
};

describe("DatabaseCachingEditor", () => {
  it("lists the default policy and each database with the policy it uses", async () => {
    setup({
      cacheConfigs: [
        rootAdaptive,
        createMockCacheConfigWithDurationStrategy({
          model: "database",
          model_id: 2,
        }),
      ],
    });

    expect(
      await screen.findByRole("button", {
        name: "Edit Default policy, currently Adaptive",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit Sales, currently Adaptive" }),
    ).toHaveTextContent("Default: Adaptive");
    expect(
      screen.getByRole("button", {
        name: "Edit Warehouse, currently Duration: 1h",
      }),
    ).toHaveTextContent("Duration: 1h");
  });

  it("offers every strategy for the default policy", async () => {
    setup();
    await userEvent.click(await screen.findByTestId("cache-strategy-select"));
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringMatching(/^Adaptive/),
      expect.stringMatching(/^Duration/),
      expect.stringMatching(/^Schedule/),
      expect.stringMatching(/^Don.t cache results/),
    ]);
  });

  it("gives a database a policy of its own", async () => {
    setup();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Edit Sales, currently Adaptive",
      }),
    );
    const form = await screen.findByTestId("strategy-form-for-database-1");
    expect(within(form).getByText("Sales")).toBeInTheDocument();

    await userEvent.click(within(form).getByTestId("cache-strategy-select"));
    await userEvent.click(
      await screen.findByRole("option", { name: /^Duration/ }),
    );
    await userEvent.type(
      within(form).getByRole("spinbutton", { name: /Cache duration/ }),
      "2",
    );
    await userEvent.click(
      within(form).getByRole("button", { name: "Save changes" }),
    );

    await waitFor(async () =>
      expect(await lastRequestBody("PUT")).toEqual({
        model: "database",
        model_id: 1,
        strategy: {
          type: "duration",
          duration: 2,
          unit: CacheDurationUnit.Hours,
          refresh_automatically: false,
        },
      }),
    );
    expect(
      await screen.findByRole("button", {
        name: "Edit Sales, currently Duration: 2h",
      }),
    ).toBeInTheDocument();
  });

  it("asks before discarding unsaved changes when another target is picked", async () => {
    setup();
    await userEvent.click(await screen.findByTestId("cache-strategy-select"));
    await userEvent.click(
      await screen.findByRole("option", { name: /^Don.t cache/ }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Edit Sales, currently Adaptive" }),
    );
    expect(
      await screen.findByText("Discard your changes?"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(
      await screen.findByTestId("strategy-form-for-database-1"),
    ).toBeInTheDocument();
  });

  it("clears the cache of a database that caches its results", async () => {
    setup();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Edit Warehouse, currently Adaptive",
      }),
    );
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Clear cache for this database",
      }),
    );
    await userEvent.click(
      within(await screen.findByTestId("confirm-modal")).getByRole("button", {
        name: "Clear cache",
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Cache cleared" }),
    ).toBeInTheDocument();
    const call = fetchMock.callHistory.lastCall("path:/api/cache/invalidate");
    expect(new URL(String(call?.url)).searchParams.get("database")).toBe("2");
  });

  it("doesn't offer to clear the cache of a database that doesn't cache", async () => {
    setup({ cacheConfigs: [] });
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Edit Sales, currently No caching",
      }),
    );
    await screen.findByTestId("strategy-form-for-database-1");
    expect(
      screen.queryByRole("button", { name: "Clear cache for this database" }),
    ).not.toBeInTheDocument();
  });

  it("clears every cached result from the default policy", async () => {
    setup();
    await userEvent.click(
      await screen.findByRole("button", { name: "Clear all cached results" }),
    );
    await userEvent.click(
      within(await screen.findByTestId("confirm-modal")).getByRole("button", {
        name: "Clear cache",
      }),
    );
    await screen.findByRole("button", { name: "Cache cleared" });
    const call = fetchMock.callHistory.lastCall("path:/api/cache/invalidate");
    expect(new URL(String(call?.url)).searchParams.get("root")).toBe("0");
  });

  it("resets every database to the default policy", async () => {
    setup({
      cacheConfigs: [
        rootAdaptive,
        createMockCacheConfigWithDurationStrategy({
          model: "database",
          model_id: 1,
        }),
        createMockCacheConfigWithDurationStrategy({
          model: "database",
          model_id: 2,
        }),
      ],
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Reset all to default" }),
    );
    await userEvent.click(
      within(await screen.findByTestId("confirm-modal")).getByRole("button", {
        name: "Reset",
      }),
    );
    await waitFor(async () =>
      expect(await lastRequestBody("DELETE")).toEqual({
        model: "database",
        model_id: [1, 2],
      }),
    );
    expect(
      await screen.findByRole("button", {
        name: "Edit Sales, currently Adaptive",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reset all to default" }),
    ).not.toBeInTheDocument();
  });
});
