import userEvent from "@testing-library/user-event";
import fetchMock from "fetch-mock";

import { setupUpdateSettingEndpoint } from "__support__/server-mocks";
import { createMockSettingsState } from "__support__/state";
import { renderWithProviders, screen, waitFor } from "__support__/ui";

import { SqlErrorsPreference } from "./SqlErrorsPreference";

interface SetupOpts {
  showSqlErrors?: boolean;
  isMetabotEnabled?: boolean;
}

const setup = ({
  showSqlErrors = false,
  isMetabotEnabled = true,
}: SetupOpts = {}) => {
  setupUpdateSettingEndpoint();
  renderWithProviders(<SqlErrorsPreference />, {
    storeInitialState: {
      settings: createMockSettingsState({
        "metabot-enabled?": isMetabotEnabled,
        "metabot-name": "Metabot",
        "metabot-show-sql-errors": showSqlErrors,
      }),
    },
  });
};

const getSwitch = () =>
  screen.getByRole("switch", { name: /Show me SQL and database errors/ });

describe("SqlErrorsPreference", () => {
  it("shows whether SQL and database errors are shown", () => {
    setup({ showSqlErrors: true });
    expect(getSwitch()).toBeChecked();
  });

  it("saves the preference when it is turned on", async () => {
    setup({ showSqlErrors: false });
    expect(getSwitch()).not.toBeChecked();

    await userEvent.click(getSwitch());

    await waitFor(() =>
      expect(
        fetchMock.callHistory.called(
          "path:/api/setting/metabot-show-sql-errors",
          {
            method: "PUT",
          },
        ),
      ).toBe(true),
    );
    const call = fetchMock.callHistory.lastCall(
      "path:/api/setting/metabot-show-sql-errors",
      { method: "PUT" },
    );
    const body: unknown = JSON.parse(String(await call?.request?.text()));
    expect(body).toEqual({ value: true });
  });

  it("isn't offered when Metabot is off", () => {
    setup({ isMetabotEnabled: false });
    expect(
      screen.queryByRole("switch", { name: /Show me SQL and database errors/ }),
    ).not.toBeInTheDocument();
  });
});
