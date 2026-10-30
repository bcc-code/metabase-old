import userEvent from "@testing-library/user-event";
import fetchMock from "fetch-mock";

import { setupInvalidateCacheEndpoint } from "__support__/server-mocks";
import { renderWithProviders, screen, within } from "__support__/ui";
import type { CacheableModel } from "metabase-types/api";

import { ClearCacheButton } from "./ClearCacheButton";

interface SetupOpts {
  targetId?: number;
  targetModel?: CacheableModel;
  targetName?: string;
  status?: number;
}

const setup = ({
  targetId = 1,
  targetModel = "database",
  targetName = "Sample Database",
  status = 200,
}: SetupOpts = {}) => {
  setupInvalidateCacheEndpoint({ status });
  renderWithProviders(
    <ClearCacheButton
      targetId={targetId}
      targetModel={targetModel}
      targetName={targetName}
    />,
  );
};

const invalidateCalls = () =>
  fetchMock.callHistory.calls("path:/api/cache/invalidate");

describe("ClearCacheButton", () => {
  it.each<[CacheableModel, string]>([
    ["database", "Clear cache for this database"],
    ["dashboard", "Clear cache for this dashboard"],
    ["question", "Clear cache for this question"],
    ["metric", "Clear cache for this metric"],
    ["root", "Clear all cached results"],
  ])("is labelled for a %s", (targetModel, label) => {
    setup({ targetModel });
    expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  });

  it("clears the cache of the target and everything under it once confirmed", async () => {
    setup({ targetId: 3, targetModel: "database" });

    await userEvent.click(
      screen.getByRole("button", { name: "Clear cache for this database" }),
    );
    const modal = await screen.findByTestId("confirm-modal");
    expect(
      within(modal).getByText("Clear the cache for Sample Database?"),
    ).toBeInTheDocument();
    expect(invalidateCalls()).toHaveLength(0);

    await userEvent.click(
      within(modal).getByRole("button", { name: "Clear cache" }),
    );

    expect(
      await screen.findByRole("button", { name: "Cache cleared" }),
    ).toBeInTheDocument();
    const calls = invalidateCalls();
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.searchParams.get("include")).toBe("overrides");
    expect(url.searchParams.get("database")).toBe("3");
  });

  it("clears the cache of a metric as a question's", async () => {
    setup({ targetId: 7, targetModel: "metric", targetName: "Revenue" });
    await userEvent.click(
      screen.getByRole("button", { name: "Clear cache for this metric" }),
    );
    await userEvent.click(
      within(await screen.findByTestId("confirm-modal")).getByRole("button", {
        name: "Clear cache",
      }),
    );
    await screen.findByRole("button", { name: "Cache cleared" });
    expect(new URL(invalidateCalls()[0].url).searchParams.get("question")).toBe(
      "7",
    );
  });

  it("clears every cached result for the default policy", async () => {
    setup({ targetId: 0, targetModel: "root", targetName: "Default policy" });
    await userEvent.click(
      screen.getByRole("button", { name: "Clear all cached results" }),
    );
    const modal = await screen.findByTestId("confirm-modal");
    expect(
      within(modal).getByText("Clear all cached results?"),
    ).toBeInTheDocument();
    await userEvent.click(
      within(modal).getByRole("button", { name: "Clear cache" }),
    );
    await screen.findByRole("button", { name: "Cache cleared" });
    expect(new URL(invalidateCalls()[0].url).searchParams.get("root")).toBe(
      "0",
    );
  });

  it("does nothing when the confirmation is cancelled", async () => {
    setup();
    await userEvent.click(
      screen.getByRole("button", { name: "Clear cache for this database" }),
    );
    await userEvent.click(
      within(await screen.findByTestId("confirm-modal")).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(
      screen.getByRole("button", { name: "Clear cache for this database" }),
    ).toBeInTheDocument();
    expect(invalidateCalls()).toHaveLength(0);
  });

  it("can be tried again when clearing fails", async () => {
    setup({ status: 500 });
    await userEvent.click(
      screen.getByRole("button", { name: "Clear cache for this database" }),
    );
    await userEvent.click(
      within(await screen.findByTestId("confirm-modal")).getByRole("button", {
        name: "Clear cache",
      }),
    );
    expect(
      await screen.findByRole("button", {
        name: "Clear cache for this database",
      }),
    ).toBeEnabled();
    expect(invalidateCalls()).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "Cache cleared" }),
    ).not.toBeInTheDocument();
  });
});
