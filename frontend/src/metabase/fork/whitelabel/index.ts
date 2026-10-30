import { t } from "ttag";

import {
  PLUGIN_HOMEPAGE_SETTING,
  PLUGIN_LANDING_PAGE,
  PLUGIN_LOGO_ICON_COMPONENTS,
  PLUGIN_SELECTORS,
  PLUGIN_WHITELABEL,
} from "metabase/plugins";
import MetabaseSettings from "metabase/utils/settings";

import { BrandingSettingsPage } from "./components/BrandingSettingsPage";
import { ConcealSettingsPage } from "./components/ConcealSettingsPage";
import { EmbeddedAppearanceSettings } from "./components/EmbeddedAppearanceSettings";
import { LandingPageUrlInput } from "./components/LandingPageUrlInput";
import { WhitelabelLogoIcon } from "./components/WhitelabelLogoIcon";
import {
  getApplicationName,
  getIsWhiteLabeling,
  getLandingPageIllustration,
  getLoadingMessageFactory,
  getLoginPageIllustration,
  getNoDataIllustration,
  getNoObjectIllustration,
  getShowMetabaseLinks,
} from "./selectors";

/**
 * Fills the whitelabel plugin slots: the Appearance admin pages, and the
 * selectors and components that apply the branding settings across the app.
 */
export function initializeWhitelabelPlugin() {
  PLUGIN_WHITELABEL.WhiteLabelBrandingSettingsPage = BrandingSettingsPage;
  PLUGIN_WHITELABEL.WhiteLabelConcealSettingsPage = ConcealSettingsPage;
  PLUGIN_WHITELABEL.EmbeddedAppearanceSettings = EmbeddedAppearanceSettings;

  Object.assign(PLUGIN_SELECTORS, {
    canWhitelabel: () => true,
    getApplicationName,
    getIsWhiteLabeling,
    getShowMetabaseLinks,
    getLoadingMessageFactory,
    getLoginPageIllustration,
    getLandingPageIllustration,
    getNoDataIllustration,
    getNoObjectIllustration,
  } satisfies Partial<typeof PLUGIN_SELECTORS>);

  if (!PLUGIN_LOGO_ICON_COMPONENTS.includes(WhitelabelLogoIcon)) {
    PLUGIN_LOGO_ICON_COMPONENTS.unshift(WhitelabelLogoIcon);
  }

  // `landing-page` needs a signed-in user, so it isn't in the bootstrap data,
  // and this runs outside React: read it from the settings kept in sync with
  // the session properties.
  PLUGIN_LANDING_PAGE.getLandingPage = () =>
    MetabaseSettings.get("landing-page");

  PLUGIN_HOMEPAGE_SETTING.CustomUrlOption = {
    get label() {
      return t`Custom URL`;
    },
    Control: LandingPageUrlInput,
  };
}
