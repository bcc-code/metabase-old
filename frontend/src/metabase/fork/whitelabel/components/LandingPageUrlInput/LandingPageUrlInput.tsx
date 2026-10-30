import { useState } from "react";
import { t } from "ttag";

import { getErrorMessage } from "metabase/api/utils/errors";
import { useAdminSetting } from "metabase/settings";
import { Text, TextInput } from "metabase/ui";

/**
 * The relative URL people land on after signing in, saved in the
 * `landing-page` setting.
 */
export function LandingPageUrlInput() {
  const { value, updateSetting } = useAdminSetting("landing-page");
  const [url, setUrl] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);

  const handleBlur = async () => {
    const nextUrl = url.trim();
    if (nextUrl === (value ?? "")) {
      return;
    }
    const { error: saveError } = await updateSetting({
      key: "landing-page",
      value: nextUrl,
    });
    setError(
      saveError
        ? getErrorMessage(saveError, t`This field must be a relative URL.`)
        : null,
    );
  };

  return (
    <>
      <TextInput
        aria-label={t`Custom homepage URL`}
        placeholder="/dashboard/1"
        value={url}
        error={error}
        onChange={(event) => setUrl(event.target.value)}
        onBlur={handleBlur}
        maw="24rem"
      />
      <Text size="xs" c="text-secondary" mt="xxs">
        {t`A relative URL in this instance, like /dashboard/1 or /collection/2.`}
      </Text>
    </>
  );
}
