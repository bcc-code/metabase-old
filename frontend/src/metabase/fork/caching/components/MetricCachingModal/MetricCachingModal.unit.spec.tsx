import userEvent from "@testing-library/user-event";
import fetchMock from "fetch-mock";

import {
  setupInvalidateCacheEndpoint,
  setupPerformanceEndpoints,
} from "__support__/server-mocks";
import { renderWithProviders, screen, waitFor, within } from "__support__/ui";
import { Route } from "metabase/router";
import type { CacheConfig } from "metabase-types/api";
import { createMockCacheConfig } from "metabase-types/api/mocks";

import { initializeCachingPlugin } from "../..";

import { MetricCachingModal } from "./MetricCachingModal";

interface SetupOpts {
  cacheConfigs?: CacheConfig[];
}

const setup = ({ cacheConfigs = [] }: SetupOpts = {}) => {
  initializeCachingPlugin();
  setupPerformanceEndpoints(cacheConfigs);
  setupInvalidateCacheEndpoint();
  const onClose = jest.fn<void, []>();
  renderWithProviders(
    <Route
      path="*"
      element={
        <MetricCachingModal cardId={9} cardName="Revenue" onClose={onClose} />
      }
    />,
    { withRouter: true },
  );
  return { onClose };
};

describe("MetricCachingModal", () => {
  it("saves a policy for the metric, as a question's", async () => {
    const { onClose } = setup();
    const modal = await screen.findByRole("dialog", {
      name: "Caching settings",
    });
    await userEvent.click(
      await within(modal).findByTestId("cache-strategy-select"),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: /^Don.t cache/ }),
    );
    await userEvent.click(within(modal).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const call = fetchMock.callHistory.lastCall("path:/api/cache", {
      method: "PUT",
    });
    const body: unknown = JSON.parse(String(await call?.request?.text()));
    expect(body).toEqual({
      model: "question",
      model_id: 9,
      strategy: { type: "nocache" },
    });
  });

  it("shows the saved policy of the metric, and offers to clear its cache", async () => {
    setup({
      cacheConfigs: [
        createMockCacheConfig({
          model: "question",
          model_id: 9,
          strategy: { type: "ttl", multiplier: 5, min_duration_ms: 2000 },
        }),
      ],
    });
    await waitFor(() =>
      expect(screen.getByTestId("cache-strategy-select")).toHaveValue(
        "Adaptive",
      ),
    );
    expect(
      screen.getByRole("button", { name: "Clear cache for this metric" }),
    ).toBeInTheDocument();
  });

  it("asks before closing with unsaved changes", async () => {
    const { onClose } = setup();
    await userEvent.click(await screen.findByTestId("cache-strategy-select"));
    await userEvent.click(
      await screen.findByRole("option", { name: /^Duration/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      await screen.findByText("Discard your changes?"),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
