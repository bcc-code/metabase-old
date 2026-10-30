import type { AuthProviderButtonProps } from "metabase/plugins/types";
import { Anchor, Button } from "metabase/ui";

import { getSsoLoginUrl } from "../../utils";

interface SsoLoginButtonProps extends AuthProviderButtonProps {
  label: string;
  /** The backend route that starts the sign-in. */
  path: string;
}

/**
 * Starts a single sign-on flow with a full page load, since the flow is
 * served by the backend. Shown as a primary button on the sign-in page and as
 * a link under the password form.
 */
export function SsoLoginButton({
  label,
  path,
  isCard,
  redirectUrl,
}: SsoLoginButtonProps) {
  const href = getSsoLoginUrl(path, redirectUrl);

  if (isCard) {
    return (
      <Button component="a" href={href} variant="filled" size="lg" fullWidth>
        {label}
      </Button>
    );
  }

  return (
    <Anchor href={href} c="text-primary" fw="bold" underline="never">
      {label}
    </Anchor>
  );
}
