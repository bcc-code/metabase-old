import { t } from "ttag";

import { Alert, Icon } from "metabase/ui";

/** OAuth error codes are short lowercase words with underscores. */
const PROVIDER_ERROR_CODE_PATTERN = /^[a-z_]{1,64}$/;

const getMessage = (code: string): string => {
  switch (code) {
    case "not-enabled":
      return t`This sign-in method isn't turned on. Please contact an administrator.`;
    case "configuration":
      return t`Single sign-on isn't set up correctly. Please contact an administrator.`;
    case "state":
      return t`Your sign-in attempt expired or was started in another window. Please try again.`;
    case "provider":
      return t`Your identity provider couldn't sign you in.`;
    case "invalid-token":
      return t`The response from your identity provider couldn't be verified. Please try again, or contact an administrator if this keeps happening.`;
    case "email-missing":
      return t`Your identity provider didn't share an email address, which you need to sign in.`;
    case "email-not-verified":
      return t`Your identity provider hasn't verified your email address yet.`;
    case "domain-not-allowed":
      return t`Your email address isn't from a domain that's allowed to sign in.`;
    case "no-account":
      return t`You'll need an administrator to create an account for you before you can sign in.`;
    case "account-disabled":
      return t`Your account is disabled. Please contact your administrator.`;
    case "not-allowed":
      return t`This account can't sign in this way.`;
    default:
      return t`Something went wrong while signing you in. Please try again.`;
  }
};

interface SsoLoginErrorProps {
  /** The `sso_error` the backend's single sign-on flow sent the browser back with. */
  code: string;
  /** The OAuth error code the identity provider returned, if any. */
  providerErrorCode?: string | null;
}

/**
 * Explains why a single sign-on attempt failed. Only fixed messages are
 * shown, picked by `code`, so a crafted link can't put its own text here.
 */
export function SsoLoginError({ code, providerErrorCode }: SsoLoginErrorProps) {
  const isProviderErrorCodeShown =
    providerErrorCode != null &&
    PROVIDER_ERROR_CODE_PATTERN.test(providerErrorCode);

  return (
    <Alert
      color="error"
      variant="light"
      icon={<Icon name="warning" />}
      role="alert"
    >
      {getMessage(code)}
      {isProviderErrorCodeShown && ` (${providerErrorCode})`}
    </Alert>
  );
}
