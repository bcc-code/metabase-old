import userEvent from "@testing-library/user-event";

import {
  findRequests,
  setupSettingsEndpoints,
  setupStatefulSettingsEndpoints,
} from "__support__/server-mocks";
import { createMockSettingsState } from "__support__/state";
import { renderWithProviders, screen, waitFor, within } from "__support__/ui";
import { UndoListing } from "metabase/common/components/UndoListing";
import type { EnterpriseSettings, SettingDefinition } from "metabase-types/api";
import {
  createMockSettingDefinition,
  createMockSettings,
} from "metabase-types/api/mocks";

import { BCC_THEME_COLORS } from "../../bcc-theme";

import { BrandingSettingsPage } from "./BrandingSettingsPage";

interface SetupOpts {
  settings?: Partial<EnterpriseSettings>;
  settingDefinitions?: SettingDefinition[];
}

async function setup({
  settings = {},
  settingDefinitions = [],
}: SetupOpts = {}) {
  const allSettings = createMockSettings({
    "available-fonts": ["Archivo", "Lato", "Open Sans"],
    "application-name": "Metabase",
    "application-logo-url": "app/assets/img/logo.svg",
    "application-favicon-url": "app/assets/img/favicon.ico",
    "application-font": "Lato",
    "application-font-files": null,
    "application-colors": {},
    "loading-message": "doing-science",
    ...settings,
  });
  const store = setupStatefulSettingsEndpoints(allSettings);
  setupSettingsEndpoints(settingDefinitions);

  renderWithProviders(
    <>
      <BrandingSettingsPage />
      <UndoListing />
    </>,
    { storeInitialState: { settings: createMockSettingsState(allSettings) } },
  );

  await screen.findByTestId("application-name-setting");

  return { store };
}

async function findPut(url: string) {
  const puts = await findRequests("PUT");
  return puts.filter((request) => request.url.endsWith(url));
}

describe("BrandingSettingsPage", () => {
  it("shows every branding setting", async () => {
    await setup();

    for (const title of [
      "BCC theme",
      "Name and logo",
      "Colors",
      "Text",
      "Illustrations",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Upload logo")).toBeInTheDocument();
    expect(screen.getByLabelText("Upload favicon")).toBeInTheDocument();
    expect(screen.getByText("Loading message")).toBeInTheDocument();
    expect(
      screen.getByTestId("login-page-illustration-setting"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("no-object-illustration-setting"),
    ).toBeInTheDocument();
  });

  describe("BCC theme", () => {
    it("saves BCC's colors and font after confirmation", async () => {
      const { store } = await setup({
        settings: {
          "application-font-files": [
            {
              src: "https://example.com/font.woff2",
              fontFormat: "woff2",
              fontWeight: 400,
            },
          ],
        },
      });

      expect(screen.getByLabelText("Font")).toHaveValue("Custom…");

      await userEvent.click(
        screen.getByRole("button", { name: "Use BCC theme" }),
      );
      const dialog = await screen.findByRole("dialog");
      expect(
        within(dialog).getByText("Use the BCC theme?"),
      ).toBeInTheDocument();
      expect(await findPut("/api/setting")).toHaveLength(0);

      await userEvent.click(
        within(dialog).getByRole("button", { name: "Use BCC theme" }),
      );

      await waitFor(async () => {
        expect(await findPut("/api/setting")).toHaveLength(1);
      });
      const [{ body }] = await findPut("/api/setting");
      expect(body).toEqual({
        "application-colors": BCC_THEME_COLORS,
        "application-font": "Archivo",
        "application-font-files": null,
      });
      expect(store["application-font"]).toBe("Archivo");

      await waitFor(() => {
        expect(
          screen.getByRole("textbox", { name: "Primary color" }),
        ).toHaveValue("#014D49");
      });
      expect(
        screen.getByRole("textbox", { name: "Chart color 6" }),
      ).toHaveValue("#A98C66");
      expect(screen.getByLabelText("Font")).toHaveValue("Archivo");
      expect(
        screen.queryByRole("textbox", { name: "Regular" }),
      ).not.toBeInTheDocument();
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });

    it("changes nothing when cancelled", async () => {
      await setup();

      await userEvent.click(
        screen.getByRole("button", { name: "Use BCC theme" }),
      );
      const dialog = await screen.findByRole("dialog");
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Cancel" }),
      );

      expect(await findRequests("PUT")).toHaveLength(0);
    });
  });

  it("saves the application name", async () => {
    await setup();

    const input = screen.getByDisplayValue("Metabase");
    await userEvent.clear(input);
    await userEvent.type(input, "BCC Insights");
    await userEvent.tab();

    await waitFor(async () => {
      expect(await findPut("/api/setting/application-name")).toHaveLength(1);
    });
    const [{ body }] = await findPut("/api/setting/application-name");
    expect(body).toEqual({ value: "BCC Insights" });
  });

  describe("logo", () => {
    it("uploads a logo as a data URI and can restore the default logo", async () => {
      await setup();
      expect(
        screen.queryByRole("button", { name: "Use the default logo" }),
      ).not.toBeInTheDocument();

      await userEvent.upload(
        screen.getByLabelText("Upload logo"),
        new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" }),
      );

      await waitFor(async () => {
        expect(await findPut("/api/setting/application-logo-url")).toHaveLength(
          1,
        );
      });
      const [upload] = await findPut("/api/setting/application-logo-url");
      expect(upload.body).toEqual({
        value: `data:image/svg+xml;base64,${btoa("<svg/>")}`,
      });

      expect(
        await screen.findByRole("img", { name: "Metabase logo" }),
      ).toHaveAttribute("src", `data:image/svg+xml;base64,${btoa("<svg/>")}`);

      await userEvent.click(
        await screen.findByRole("button", { name: "Use the default logo" }),
      );
      await waitFor(async () => {
        expect(await findPut("/api/setting/application-logo-url")).toHaveLength(
          2,
        );
      });
      const [, reset] = await findPut("/api/setting/application-logo-url");
      expect(reset.body).toEqual({ value: "app/assets/img/logo.svg" });
    });

    it("rejects files in other formats", async () => {
      await setup();

      await userEvent.upload(
        screen.getByLabelText("Upload favicon"),
        new File(["gif"], "favicon.gif", { type: "image/gif" }),
        { applyAccept: false },
      );

      expect(
        await screen.findByText(
          "Choose an image in one of these formats: ICO, PNG, SVG.",
        ),
      ).toBeInTheDocument();
      expect(await findRequests("PUT")).toHaveLength(0);
    });
  });

  describe("colors", () => {
    it("saves a changed color and can reset it", async () => {
      await setup({
        settings: { "application-colors": { filter: "#49706D" } },
      });

      const input = screen.getByRole("textbox", { name: "Primary color" });
      await userEvent.clear(input);
      await userEvent.type(input, "#004D48");

      await waitFor(
        async () => {
          const puts = await findPut("/api/setting/application-colors");
          expect(puts.at(-1)?.body).toEqual({
            value: { filter: "#49706D", brand: "#004D48" },
          });
        },
        { timeout: 3000 },
      );

      await userEvent.click(
        screen.getByRole("button", { name: "Reset Filter color to default" }),
      );
      await waitFor(
        async () => {
          const puts = await findPut("/api/setting/application-colors");
          expect(puts.at(-1)?.body).toEqual({ value: { brand: "#004D48" } });
        },
        { timeout: 3000 },
      );
    });

    it("resets all colors", async () => {
      await setup({ settings: { "application-colors": BCC_THEME_COLORS } });

      await userEvent.click(
        screen.getByRole("button", { name: "Reset all colors to default" }),
      );

      await waitFor(async () => {
        const puts = await findPut("/api/setting/application-colors");
        expect(puts.at(-1)?.body).toEqual({ value: null });
      });
      expect(
        screen.queryByRole("button", { name: "Reset all colors to default" }),
      ).not.toBeInTheDocument();
    });

    it("shows that the colors are set by an environment variable", async () => {
      await setup({
        settingDefinitions: [
          createMockSettingDefinition({
            key: "application-colors",
            is_env_setting: true,
            env_name: "MB_APPLICATION_COLORS",
          }),
        ],
      });

      expect(
        await screen.findByRole("link", { name: "MB_APPLICATION_COLORS" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("textbox", { name: "Primary color" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("font", () => {
    it("saves a system font and drops custom font files", async () => {
      await setup();

      await userEvent.click(screen.getByLabelText("Font"));
      await userEvent.click(
        await screen.findByRole("option", { name: "Arial" }),
      );

      await waitFor(async () => {
        expect(await findPut("/api/setting")).toHaveLength(1);
      });
      const [{ body }] = await findPut("/api/setting");
      expect(body).toEqual({
        "application-font": "Arial",
        "application-font-files": null,
      });
    });

    it("saves custom font files", async () => {
      await setup();

      await userEvent.click(screen.getByLabelText("Font"));
      await userEvent.click(
        await screen.findByRole("option", { name: "Custom…" }),
      );

      const regular = await screen.findByRole("textbox", { name: "Regular" });
      await userEvent.type(regular, "https://example.com/fonts/regular.woff2");
      await userEvent.tab();

      await waitFor(async () => {
        expect(await findPut("/api/setting")).toHaveLength(1);
      });
      const [{ body }] = await findPut("/api/setting");
      expect(body).toEqual({
        "application-font-files": [
          {
            src: "https://example.com/fonts/regular.woff2",
            fontFormat: "woff2",
            fontWeight: 400,
          },
        ],
      });
    });

    it("explains why a custom font URL can't be used", async () => {
      await setup();

      await userEvent.click(screen.getByLabelText("Font"));
      await userEvent.click(
        await screen.findByRole("option", { name: "Custom…" }),
      );
      const bold = await screen.findByRole("textbox", { name: "Bold" });
      await userEvent.type(bold, "https://example.com/fonts/bold.otf");
      await userEvent.tab();

      expect(
        await screen.findByText("Use a .woff2, .woff or .ttf file"),
      ).toBeInTheDocument();
      expect(await findRequests("PUT")).toHaveLength(0);
    });
  });

  it("saves the loading message", async () => {
    await setup();

    await userEvent.click(screen.getByLabelText("Loading message"));
    await userEvent.click(
      await screen.findByRole("option", { name: "Running query..." }),
    );

    await waitFor(async () => {
      expect(await findPut("/api/setting/loading-message")).toHaveLength(1);
    });
    const [{ body }] = await findPut("/api/setting/loading-message");
    expect(body).toEqual({ value: "running-query" });
  });
});
