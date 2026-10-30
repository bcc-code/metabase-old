import userEvent from "@testing-library/user-event";

import { screen, within } from "__support__/ui";

import { getLastHomepageSettingSettingCall, setup } from "./setup";

describe("EmbedHomepage (OSS)", () => {
  it("should link to the docs for static embedding", () => {
    setup();

    expect(
      screen.getAllByRole("link", { name: "Read the docs" })[0],
    ).toHaveAttribute(
      "href",
      "https://www.metabase.com/docs/latest/embedding/guest-embedding.html?utm_source=product&source_plan=oss&utm_content=embedding-homepage",
    );
  });

  it("should link to the docs for embed js embedding", () => {
    setup();

    const embedJsSection = screen.getByRole("region", {
      name: "Modular embedding",
    });

    // Then find the "Read the docs" button within that section
    const readEmbedJsDocsLink = within(embedJsSection).getByRole("link", {
      name: "Read the docs",
    });

    expect(readEmbedJsDocsLink).toHaveAttribute(
      "href",
      "https://www.metabase.com/docs/latest/embedding/modular-embedding.html?utm_source=product&source_plan=oss&utm_content=embedding-homepage",
    );
  });

  it("should link to the SDK quickstart", () => {
    setup();

    expect(
      screen.getAllByRole("link", { name: "Check out the Quickstart" })[0],
    ).toHaveAttribute(
      "href",
      "https://metaba.se/sdk-quick-start?utm_source=product&source_plan=oss&utm_content=embedding-homepage",
    );
  });

  it("should link to the SDK docs", () => {
    setup();

    const sdkSection = screen.getByRole("region", {
      name: "Embedded analytics SDK for React",
    });

    const readSdkDocsLink = within(sdkSection).getByRole("link", {
      name: "Read the docs",
    });

    expect(readSdkDocsLink).toHaveAttribute(
      "href",
      "https://metaba.se/sdk-docs?utm_source=product&source_plan=oss&utm_content=embedding-homepage",
    );
  });

  it("should link to the example dashboard if `example-dashboard-id` is set", () => {
    setup({ settings: { "example-dashboard-id": 1 } });

    expect(
      screen.getByRole("link", {
        name: /Embed an example dashboard/i,
      }),
    ).toHaveAttribute("href", "/dashboard/1");
  });

  it("should set 'embedding-homepage' to 'dismissed-done' when dismissing as done", async () => {
    setup();
    await userEvent.hover(screen.getByText("Hide these"));

    await userEvent.click(screen.getByText("Embedding done, all good"));

    const lastCall = getLastHomepageSettingSettingCall();

    const body = await lastCall?.request?.json();
    expect(body).toEqual({ value: "dismissed-done" });
  });

  it("should set 'embedding-homepage' to 'dismissed-not-interested-now' when dismissing because not interested", async () => {
    setup();
    await userEvent.hover(screen.getByText("Hide these"));

    await userEvent.click(screen.getByText("I'm not interested right now"));

    const lastCall = getLastHomepageSettingSettingCall();

    const body = await lastCall?.request?.json();
    expect(body).toEqual({ value: "dismissed-not-interested-now" });
  });

  it("should set 'embedding-homepage' to 'dismissed-run-into-issues' when dismissing because of issues", async () => {
    setup();
    await userEvent.hover(screen.getByText("Hide these"));

    await userEvent.click(screen.getByText("I ran into issues"));

    const lastCall = getLastHomepageSettingSettingCall();

    const body = await lastCall?.request?.json();
    expect(body).toEqual({ value: "dismissed-run-into-issues" });
  });

  it("should not advertise paid embedding to OSS admins", () => {
    setup({ isAdmin: true });

    expect(screen.getByText("Guest embedding")).toBeInTheDocument();
    expect(screen.queryByText("More advanced embeds")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Try Metabase Pro" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Pro and Enterprise/)).not.toBeInTheDocument();
  });
});
