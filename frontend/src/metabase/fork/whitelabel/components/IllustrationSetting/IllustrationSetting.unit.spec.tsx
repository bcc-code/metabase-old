import userEvent from "@testing-library/user-event";

import {
  findRequests,
  setupSettingsEndpoints,
  setupStatefulSettingsEndpoints,
} from "__support__/server-mocks";
import { createMockSettingsState } from "__support__/state";
import { renderWithProviders, screen, waitFor } from "__support__/ui";
import type { EnterpriseSettings } from "metabase-types/api";
import { createMockSettings } from "metabase-types/api/mocks";

import { IllustrationSetting } from "./IllustrationSetting";

const UPLOADED_URL =
  "api/session/illustration/login-page-illustration-custom?v=0123456789abcdef";

interface SetupOpts {
  settings?: Partial<EnterpriseSettings>;
}

async function setup({ settings = {} }: SetupOpts = {}) {
  const allSettings = createMockSettings({
    "login-page-illustration": "default",
    ...settings,
  });
  setupStatefulSettingsEndpoints(allSettings);
  setupSettingsEndpoints([]);

  renderWithProviders(
    <IllustrationSetting
      name="login-page-illustration"
      title="Login page"
      description="Shown behind the login form."
      defaultSrc="app/assets/img/bridge.svg"
    />,
    { storeInitialState: { settings: createMockSettingsState(allSettings) } },
  );

  await screen.findByTestId("login-page-illustration-setting");
}

async function getPutBodies() {
  const puts = await findRequests("PUT");
  return puts.map(({ url, body }) => ({
    key: url.split("/api/setting/")[1],
    body,
  }));
}

describe("IllustrationSetting", () => {
  it("previews the default illustration", async () => {
    await setup();

    expect(
      screen.getByRole("img", {
        name: "Preview of the illustration for Login page",
      }),
    ).toHaveAttribute("src", "app/assets/img/bridge.svg");
  });

  it("hides the illustration", async () => {
    await setup();

    await userEvent.click(screen.getByRole("textbox", { name: "Login page" }));
    await userEvent.click(
      await screen.findByRole("option", { name: "No illustration" }),
    );

    await waitFor(async () => {
      expect(await getPutBodies()).toEqual([
        { key: "login-page-illustration", body: { value: "none" } },
      ]);
    });
  });

  it("saves the custom option only once an image is uploaded", async () => {
    await setup();

    await userEvent.click(screen.getByRole("textbox", { name: "Login page" }));
    await userEvent.click(
      await screen.findByRole("option", { name: "Custom" }),
    );
    expect(await findRequests("PUT")).toHaveLength(0);
    expect(screen.getByText("No image uploaded yet")).toBeInTheDocument();

    await userEvent.upload(
      screen.getByLabelText("Upload an image for Login page"),
      new File(["png"], "login.png", { type: "image/png" }),
    );

    await waitFor(async () => {
      expect(await getPutBodies()).toEqual([
        {
          key: "login-page-illustration-custom",
          body: { value: `data:image/png;base64,${btoa("png")}` },
        },
        { key: "login-page-illustration", body: { value: "custom" } },
      ]);
    });
  });

  it("previews an uploaded illustration", async () => {
    await setup({
      settings: {
        "login-page-illustration": "custom",
        "login-page-illustration-custom": UPLOADED_URL,
      },
    });

    expect(
      screen.getByRole("img", {
        name: "Preview of the illustration for Login page",
      }),
    ).toHaveAttribute("src", UPLOADED_URL);
    expect(
      screen.getByLabelText("Upload an image for Login page"),
    ).toBeInTheDocument();
  });
});
