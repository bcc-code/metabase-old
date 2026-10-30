import { getBasename } from "metabase/utils/basename";

/** The backend route that starts an OpenID Connect sign-in. */
export const OIDC_LOGIN_PATH = "/auth/sso/oidc";

/** The backend route that starts a JWT sign-in. */
export const JWT_LOGIN_PATH = "/auth/sso";

/**
 * The browser URL of the backend route `path` that starts a sign-in, coming
 * back to `redirectUrl` once signed in.
 */
export function getSsoLoginUrl(path: string, redirectUrl?: string): string {
  const query = redirectUrl
    ? `?${new URLSearchParams({ redirect: redirectUrl })}`
    : "";
  return `${getBasename()}${path}${query}`;
}

/** Whether `value` is an absolute `http:` or `https:` URL. */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
