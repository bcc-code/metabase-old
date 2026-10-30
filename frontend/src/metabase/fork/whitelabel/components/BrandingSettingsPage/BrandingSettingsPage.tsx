import { t } from "ttag";

import { useSetting } from "metabase/settings";
import {
  AdminSettingInput,
  SettingsPageWrapper,
  SettingsSection,
} from "metabase/settings-components";
import { Image } from "metabase/ui";

import {
  DEFAULT_FAVICON_URL,
  DEFAULT_LOGO_URL,
  FAVICON_MAX_SIZE_BYTES,
  LOGO_MAX_SIZE_BYTES,
  getLoadingMessageOptions,
} from "../../constants";
import { BccThemeSection } from "../BccThemeSection";
import { ColorPaletteSetting } from "../ColorPaletteSetting";
import { FontSetting } from "../FontSetting";
import {
  EmptyStateIllustrationSettings,
  PageIllustrationSettings,
} from "../IllustrationSettings";
import { ImageSetting } from "../ImageSetting";
import { WhitelabelLogoIcon } from "../WhitelabelLogoIcon";

/**
 * Admin > Settings > Appearance > Branding: the application name, logo,
 * favicon, colors, font, loading message and illustrations.
 */
export function BrandingSettingsPage() {
  return (
    <SettingsPageWrapper
      title={t`Branding`}
      description={t`Make the app look like yours. Changes apply to everyone, including on public links, embeds and in emails.`}
    >
      <BccThemeSection />

      <SettingsSection title={t`Name and logo`}>
        <AdminSettingInput
          name="application-name"
          title={t`Application name`}
          // eslint-disable-next-line metabase/no-literal-metabase-strings -- Admin settings
          description={t`Replaces the word “Metabase” in the app, page titles and emails.`}
          inputType="text"
        />
        <ImageSetting
          name="application-logo-url"
          title={t`Logo`}
          description={t`Shown in the navigation bar, on the login page and in emails. An SVG or a PNG with a transparent background works best, and emails need a PNG or JPEG.`}
          uploadLabel={t`Upload logo`}
          resetLabel={t`Use the default logo`}
          defaultValue={DEFAULT_LOGO_URL}
          formats={["svg", "png", "jpeg", "gif", "webp"]}
          maxSizeBytes={LOGO_MAX_SIZE_BYTES}
          preview={<WhitelabelLogoIcon height={32} />}
        />
        <ImageSetting
          name="application-favicon-url"
          title={t`Favicon`}
          description={t`The icon in browser tabs and bookmarks. Use a small square ICO, PNG or SVG image.`}
          uploadLabel={t`Upload favicon`}
          resetLabel={t`Use the default favicon`}
          defaultValue={DEFAULT_FAVICON_URL}
          formats={["ico", "png", "svg"]}
          maxSizeBytes={FAVICON_MAX_SIZE_BYTES}
          preview={<FaviconPreview />}
        />
      </SettingsSection>

      <SettingsSection
        title={t`Colors`}
        description={t`Pick the colors of the app and its charts.`}
      >
        <ColorPaletteSetting />
      </SettingsSection>

      <SettingsSection title={t`Text`}>
        <FontSetting />
        <AdminSettingInput
          name="loading-message"
          title={t`Loading message`}
          description={t`The message shown while a query runs.`}
          inputType="select"
          options={getLoadingMessageOptions()}
          maw="20rem"
        />
      </SettingsSection>

      <SettingsSection
        title={t`Illustrations`}
        description={t`Use the default illustrations, hide them, or upload your own images (SVG, PNG, JPEG, GIF or WebP, up to 2 MB).`}
      >
        <PageIllustrationSettings />
        <EmptyStateIllustrationSettings />
      </SettingsSection>
    </SettingsPageWrapper>
  );
}

function FaviconPreview() {
  const faviconUrl = useSetting("application-favicon-url");

  return (
    <Image
      src={faviconUrl || DEFAULT_FAVICON_URL}
      alt={t`Current favicon`}
      w="2rem"
      h="2rem"
      fit="contain"
    />
  );
}
