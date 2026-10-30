import userEvent from "@testing-library/user-event";
import fetchMock from "fetch-mock";
import type { SetStateAction } from "react";

import {
  setupInvalidateCacheEndpoint,
  setupPerformanceEndpoints,
} from "__support__/server-mocks";
import { renderWithProviders, screen, waitFor, within } from "__support__/ui";
import { Route } from "metabase/router";
import type { CacheConfig, CacheableDashboard } from "metabase-types/api";
import {
  createMockCacheConfigWithDurationStrategy,
  createMockDashboard,
} from "metabase-types/api/mocks";

import { initializeCachingPlugin } from "../..";
import { SidebarCacheSection } from "../SidebarCacheSection/SidebarCacheSection";

import { SidebarCacheForm } from "./SidebarCacheForm";

const dashboard: CacheableDashboard = {
  ...createMockDashboard({ name: "Sales overview" }),
  id: 5,
};

interface SetupOpts {
  cacheConfigs?: CacheConfig[];
}

const setupForm = ({ cacheConfigs = [] }: SetupOpts = {}) => {
  initializeCachingPlugin();
  setupPerformanceEndpoints(cacheConfigs);
  setupInvalidateCacheEndpoint();
  const onClose = jest.fn<void, []>();
  const onBack = jest.fn<void, []>();
  renderWithProviders(
    <Route
      path="*"
      element={
        <SidebarCacheForm
          item={dashboard}
          model="dashboard"
          isOpen
          onClose={onClose}
          onBack={onBack}
        />
      }
    />,
    { withRouter: true },
  );
  return { onClose, onBack };
};

const setupSection = ({ cacheConfigs = [] }: SetupOpts = {}) => {
  initializeCachingPlugin();
  setupPerformanceEndpoints(cacheConfigs);
  const setPage = jest.fn<void, [SetStateAction<"default" | "caching">]>();
  renderWithProviders(
    <SidebarCacheSection
      item={dashboard}
      model="dashboard"
      setPage={setPage}
    />,
  );
  return { setPage };
};

const dashboardDuration = createMockCacheConfigWithDurationStrategy({
  model: "dashboard",
  model_id: 5,
});

describe("SidebarCacheSection", () => {
  it("shows the policy of a dashboard with its own", async () => {
    setupSection({ cacheConfigs: [dashboardDuration] });
    const button = await screen.findByRole("button", {
      name: "When to get new results",
    });
    expect(button).toHaveTextContent("Duration: 1h");
    expect(button).toHaveAccessibleDescription("Duration: 1h");
  });

  it("shows that a dashboard without its own policy uses the default", async () => {
    setupSection();
    expect(
      await screen.findByRole("button", { name: "When to get new results" }),
    ).toHaveTextContent("Default");
  });

  it("opens the caching settings", async () => {
    const { setPage } = setupSection();
    await userEvent.click(
      await screen.findByRole("button", { name: "When to get new results" }),
    );
    expect(setPage).toHaveBeenCalledWith("caching");
  });
});

describe("SidebarCacheForm", () => {
  it("shows the saved policy of the dashboard", async () => {
    setupForm({ cacheConfigs: [dashboardDuration] });
    const sidesheet = await screen.findByRole("dialog", {
      name: /Caching settings/,
    });
    expect(
      await within(sidesheet).findByTestId("cache-strategy-select"),
    ).toHaveValue("Duration");
    expect(
      within(sidesheet).getByRole("spinbutton", { name: /Cache duration/ }),
    ).toHaveValue(1);
  });

  it("saves a policy for the dashboard and goes back", async () => {
    const { onBack } = setupForm();
    await userEvent.click(await screen.findByTestId("cache-strategy-select"));
    await userEvent.click(
      await screen.findByRole("option", { name: /^Schedule/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onBack).toHaveBeenCalled());
    const call = fetchMock.callHistory.lastCall("path:/api/cache", {
      method: "PUT",
    });
    const body: unknown = JSON.parse(String(await call?.request?.text()));
    expect(body).toEqual({
      model: "dashboard",
      model_id: 5,
      strategy: {
        type: "schedule",
        schedule: "0 0 * * * ? *",
        refresh_automatically: false,
      },
    });
  });

  it("resets the dashboard to the default policy by removing its own", async () => {
    const { onBack } = setupForm({ cacheConfigs: [dashboardDuration] });
    await waitFor(() =>
      expect(screen.getByTestId("cache-strategy-select")).toHaveValue(
        "Duration",
      ),
    );
    await userEvent.click(screen.getByTestId("cache-strategy-select"));
    await userEvent.click(
      await screen.findByRole("option", { name: /^Default/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onBack).toHaveBeenCalled());
    const call = fetchMock.callHistory.lastCall("path:/api/cache", {
      method: "DELETE",
    });
    const body: unknown = JSON.parse(String(await call?.request?.text()));
    expect(body).toEqual({ model: "dashboard", model_id: 5 });
  });

  it("offers to clear the cache of the dashboard", async () => {
    setupForm({ cacheConfigs: [dashboardDuration] });
    expect(
      await screen.findByRole("button", {
        name: "Clear cache for this dashboard",
      }),
    ).toBeInTheDocument();
  });

  it("asks before closing with unsaved changes", async () => {
    const { onClose } = setupForm();
    await userEvent.click(await screen.findByTestId("cache-strategy-select"));
    await userEvent.click(
      await screen.findByRole("option", { name: /^Adaptive/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(
      await screen.findByText("Discard your changes?"),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes right away without unsaved changes", async () => {
    const { onClose } = setupForm();
    await screen.findByTestId("cache-strategy-select");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByText("Discard your changes?")).not.toBeInTheDocument();
  });
});
