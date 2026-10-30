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

import { ConcealSettingsPage } from "./ConcealSettingsPage";

interface SetupOpts {
  settings?: Partial<EnterpriseSettings>;
  settingDefinitions?: SettingDefinition[];
}

async function setup({
  settings = {},
  settingDefinitions = [],
}: SetupOpts = {}) {
  const allSettings = createMockSettings({
    "help-link": "metabase",
    "help-link-custom-destination": "https://www.metabase.com/help-premium",
    "show-metabase-links": true,
    "show-metabot": true,
    ...settings,
  });
  setupStatefulSettingsEndpoints(allSettings);
  setupSettingsEndpoints(settingDefinitions);

  renderWithProviders(
    <>
      <ConcealSettingsPage />
      <UndoListing />
    </>,
    { storeInitialState: { settings: createMockSettingsState(allSettings) } },
  );

  await screen.findByTestId("help-link-setting");
}

async function getPutBodies(url: string) {
  const puts = await findRequests("PUT");
  return puts
    .filter((request) => request.url.endsWith(url))
    .map((request) => request.body);
}

describe("ConcealSettingsPage", () => {
  it("hides the help link", async () => {
    await setup();

    await userEvent.click(screen.getByRole("radio", { name: "Hide it" }));

    await waitFor(async () => {
      expect(await getPutBodies("/api/setting/help-link")).toEqual([
        { value: "hidden" },
      ]);
    });
  });

  it("saves a custom help link together with its destination", async () => {
    await setup();

    await userEvent.click(
      screen.getByRole("radio", { name: "Go to a custom destination..." }),
    );
    expect(await findRequests("PUT")).toHaveLength(0);

    const input = screen.getByRole("textbox", {
      name: "Custom help link destination",
    });
    expect(input).toHaveValue("");
    await userEvent.type(input, "https://help.bcc.no");
    await userEvent.tab();

    await waitFor(async () => {
      expect(await getPutBodies("/api/setting")).toEqual([
        {
          "help-link-custom-destination": "https://help.bcc.no",
          "help-link": "custom",
        },
      ]);
    });
    expect(
      screen.getByRole("radio", { name: "Go to a custom destination..." }),
    ).toBeChecked();
  });

  it("asks for a destination before saving a custom help link", async () => {
    await setup();

    await userEvent.click(
      screen.getByRole("radio", { name: "Go to a custom destination..." }),
    );
    await userEvent.click(
      screen.getByRole("textbox", { name: "Custom help link destination" }),
    );
    await userEvent.tab();

    expect(
      await screen.findByText(
        "Enter a URL, like https://help.example.com, or a mailto: link.",
      ),
    ).toBeInTheDocument();
    expect(await findRequests("PUT")).toHaveLength(0);
  });

  it("switches back to a custom destination saved before", async () => {
    await setup({
      settings: {
        "help-link": "hidden",
        "help-link-custom-destination": "https://help.bcc.no",
      },
      settingDefinitions: [
        createMockSettingDefinition({
          key: "help-link-custom-destination",
          value: "https://help.bcc.no",
        }),
      ],
    });

    await userEvent.click(
      screen.getByRole("radio", { name: "Go to a custom destination..." }),
    );

    await waitFor(async () => {
      expect(await getPutBodies("/api/setting/help-link")).toEqual([
        { value: "custom" },
      ]);
    });
    expect(
      screen.getByRole("textbox", { name: "Custom help link destination" }),
    ).toHaveValue("https://help.bcc.no");
  });

  it.each([
    ["show-metabase-links", "Metabase links"],
    ["show-metabot", "Metabot greeting"],
  ])("turns %s off", async (key, title) => {
    await setup();

    const setting = screen.getByTestId(`${key}-setting`);
    expect(setting).toHaveTextContent(title);
    await userEvent.click(within(setting).getByRole("switch"));

    await waitFor(async () => {
      expect(await getPutBodies(`/api/setting/${key}`)).toEqual([
        { value: false },
      ]);
    });
  });
});
