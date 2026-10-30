import { renderWithProviders, screen } from "__support__/ui";
import { PLUGIN_REMOTE_SYNC } from "metabase/plugins";

import { RemoteSyncSettingsPage } from "./RemoteSyncSettingsPage";

describe("RemoteSyncSettingsPage", () => {
  const defaultSettings = PLUGIN_REMOTE_SYNC.RemoteSyncSettings;

  afterEach(() => {
    PLUGIN_REMOTE_SYNC.RemoteSyncSettings = defaultSettings;
  });

  it("renders the remote sync settings of the plugin, without an upsell", () => {
    PLUGIN_REMOTE_SYNC.RemoteSyncSettings = function RemoteSyncSettings() {
      return <div>Git sync settings</div>;
    };

    renderWithProviders(<RemoteSyncSettingsPage />);

    expect(screen.getByText("Git sync settings")).toBeInTheDocument();
    expect(
      screen.queryByText(/Manage your Metabase content in Git/i),
    ).not.toBeInTheDocument();
  });
});
