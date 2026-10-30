import userEvent from "@testing-library/user-event";
import fetchMock from "fetch-mock";

import {
  setupCreateCustomVizPluginEndpoint,
  setupCustomVizPluginEndpoint,
  setupReplaceCustomVizPluginBundleEndpoint,
} from "__support__/server-mocks";
import { renderWithProviders, screen, waitFor } from "__support__/ui";
import { Route } from "metabase/router";
import { createMockCustomVizPlugin } from "metabase-types/api/mocks";

import { CustomVizPage } from "./CustomVizPage";

const HERON_RING = createMockCustomVizPlugin({
  id: 7,
  identifier: "heron-ring",
  display_name: "Heron ring",
});

const BUNDLE = new File(
  ['/* metabase-custom-viz {"apiVersion": 1} */'],
  "heron-ring.js",
  { type: "text/javascript" },
);

interface SetupOpts {
  id?: string;
}

function setup({ id }: SetupOpts = {}) {
  renderWithProviders(
    <Route path="/admin/settings/custom-visualizations">
      <Route index element={<div>Custom visualizations list</div>} />
      <Route path="new" element={<CustomVizPage params={{}} />} />
      <Route path="edit/:id" element={<CustomVizPage params={{ id }} />} />
    </Route>,
    {
      withRouter: true,
      withUndos: true,
      initialRoute:
        id === undefined
          ? "/admin/settings/custom-visualizations/new"
          : `/admin/settings/custom-visualizations/edit/${id}`,
    },
  );
}

async function uploadBundle() {
  await userEvent.upload(screen.getByLabelText("Bundle file"), BUNDLE);
}

function wasUploaded(url: string, method: "POST" | "PUT") {
  return fetchMock.callHistory.called(url, { method });
}

describe("CustomVizPage", () => {
  it("installs an uploaded bundle and goes back to the list", async () => {
    setupCreateCustomVizPluginEndpoint(HERON_RING);
    setup();

    expect(
      screen.getByRole("heading", { name: "Add a custom visualization" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install" })).toBeDisabled();

    await uploadBundle();
    await userEvent.click(screen.getByRole("button", { name: "Install" }));

    expect(
      await screen.findByText("Custom visualizations list"),
    ).toBeInTheDocument();
    expect(wasUploaded("path:/api/custom-viz-plugin", "POST")).toBe(true);
    expect(await screen.findByText("Installed Heron ring")).toBeInTheDocument();
  });

  it("shows why the server rejected a bundle", async () => {
    setupCreateCustomVizPluginEndpoint({
      status: 400,
      body: "The manifest is invalid: identifier: must be 1 to 64 lowercase letters, digits or hyphens, starting with a letter",
    });
    setup();

    await uploadBundle();
    await userEvent.click(screen.getByRole("button", { name: "Install" }));

    expect(
      await screen.findByText("The bundle wasn't installed"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The manifest is invalid: identifier: must be 1 to 64 lowercase letters, digits or hyphens, starting with a letter",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Custom visualizations list"),
    ).not.toBeInTheDocument();
  });

  it("replaces the bundle of an installed visualization", async () => {
    setupCustomVizPluginEndpoint(HERON_RING);
    setupReplaceCustomVizPluginBundleEndpoint(HERON_RING.id, HERON_RING);
    setup({ id: String(HERON_RING.id) });

    expect(
      await screen.findByRole("heading", {
        name: "Replace the bundle of Heron ring",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/must declare the identifier "heron-ring"/),
    ).toBeInTheDocument();

    await uploadBundle();
    await userEvent.click(
      screen.getByRole("button", { name: "Replace bundle" }),
    );

    await waitFor(() => {
      expect(wasUploaded("path:/api/custom-viz-plugin/7/bundle", "PUT")).toBe(
        true,
      );
    });
    expect(
      await screen.findByText("Custom visualizations list"),
    ).toBeInTheDocument();
  });
});
