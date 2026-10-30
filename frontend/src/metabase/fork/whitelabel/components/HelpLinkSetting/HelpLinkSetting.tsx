import { useState } from "react";
import { t } from "ttag";

import { getErrorMessage } from "metabase/api/utils/errors";
import { SetByEnvVar } from "metabase/common/components/SetByEnvVar";
import { useAdminSetting } from "metabase/settings";
import { SettingHeader } from "metabase/settings-components";
import { Box, Radio, Stack, TextInput } from "metabase/ui";
import type { HelpLinkSetting as HelpLinkOption } from "metabase-types/api";

const isHelpLinkOption = (value: string): value is HelpLinkOption =>
  value === "metabase" || value === "hidden" || value === "custom";

const getHelpLinkOptions = (): { value: HelpLinkOption; label: string }[] => [
  // eslint-disable-next-line metabase/no-literal-metabase-strings -- Admin settings
  { value: "metabase", label: t`Link to Metabase help` },
  { value: "hidden", label: t`Hide it` },
  { value: "custom", label: t`Go to a custom destination...` },
];

/**
 * Picks where the "Help" item in the account menu leads: to Metabase's help,
 * nowhere (hidden), or to the admin's own URL or `mailto:` link.
 */
export function HelpLinkSetting() {
  const helpLink = useAdminSetting("help-link");
  const destination = useAdminSetting("help-link-custom-destination");

  if (helpLink.isLoading || destination.isLoading) {
    return null;
  }

  const envDetails = [helpLink.settingDetails, destination.settingDetails].find(
    (details) => details?.is_env_setting,
  );

  return (
    <Box data-testid="help-link-setting">
      <SettingHeader
        id="help-link"
        title={t`Help link`}
        description={t`Where the Help item in the account menu leads.`}
      />
      {envDetails?.env_name ? (
        <SetByEnvVar varName={envDetails.env_name} />
      ) : (
        <HelpLinkForm
          helpLink={helpLink.value ?? "metabase"}
          // the setting has no value of its own while it equals the default
          savedDestination={destination.settingDetails?.value ?? null}
        />
      )}
    </Box>
  );
}

interface HelpLinkFormProps {
  helpLink: HelpLinkOption;
  savedDestination: string | null;
}

function HelpLinkForm({ helpLink, savedDestination }: HelpLinkFormProps) {
  const { updateSetting, updateSettings } = useAdminSetting("help-link");
  // "Custom" is only saved together with a destination
  const [isCustomPending, setIsCustomPending] = useState(false);
  const [url, setUrl] = useState(savedDestination ?? "");
  const [error, setError] = useState<string | null>(null);
  const option = isCustomPending ? "custom" : helpLink;

  const handleOptionChange = async (nextOption: string) => {
    if (!isHelpLinkOption(nextOption)) {
      return;
    }
    setError(null);
    if (nextOption === "custom" && savedDestination == null) {
      setIsCustomPending(true);
      return;
    }
    setIsCustomPending(false);
    await updateSetting({ key: "help-link", value: nextOption });
  };

  const handleUrlBlur = async () => {
    const nextUrl = url.trim();
    if (!nextUrl) {
      setError(
        t`Enter a URL, like https://help.example.com, or a mailto: link.`,
      );
      return;
    }
    const isUnchanged = nextUrl === savedDestination && helpLink === "custom";
    if (isUnchanged) {
      return;
    }
    const { error: saveError } = await updateSettings({
      "help-link-custom-destination": nextUrl,
      "help-link": "custom",
    });
    if (saveError) {
      setError(
        getErrorMessage(saveError, t`Please make sure this is a valid URL`),
      );
    } else {
      setError(null);
      setIsCustomPending(false);
    }
  };

  return (
    <Stack gap="md">
      <Radio.Group
        id="help-link"
        value={option}
        onChange={handleOptionChange}
        aria-label={t`Help link`}
      >
        <Stack gap="sm">
          {getHelpLinkOptions().map(({ value, label }) => (
            <Radio key={value} value={value} label={label} />
          ))}
        </Stack>
      </Radio.Group>
      {option === "custom" && (
        <TextInput
          aria-label={t`Custom help link destination`}
          placeholder="https://help.example.com"
          value={url}
          error={error}
          onChange={(event) => setUrl(event.target.value)}
          onBlur={handleUrlBlur}
          maw="28rem"
          autoFocus={isCustomPending}
        />
      )}
    </Stack>
  );
}
