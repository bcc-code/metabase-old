import { renderWithProviders, screen } from "__support__/ui";
import { PLUGIN_REMOTE_SYNC } from "metabase/plugins";

import { GitSyncSectionLayout } from "./GitSyncSectionLayout";

describe("GitSyncSectionLayout", () => {
  const defaultSettings = PLUGIN_REMOTE_SYNC.RemoteSyncSettings;

  afterEach(() => {
    PLUGIN_REMOTE_SYNC.RemoteSyncSettings = defaultSettings;
  });

  it("renders the Git sync page of the plugin, without an upsell", () => {
    PLUGIN_REMOTE_SYNC.RemoteSyncSettings = function RemoteSyncSettings() {
      return <div>Git sync page</div>;
    };

    renderWithProviders(<GitSyncSectionLayout />);

    expect(screen.getByText("Git sync page")).toBeInTheDocument();
  });
});
