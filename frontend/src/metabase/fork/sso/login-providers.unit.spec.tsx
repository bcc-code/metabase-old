import "metabase/auth/plugins";
import { mockSettings } from "__support__/settings";
import { createMockState } from "__support__/state";
import { renderWithProviders, screen } from "__support__/ui";
import { Login } from "metabase/auth/components/Login";
import { Route } from "metabase/router";
import type { EnterpriseSettings } from "metabase-types/api";

import { initializeSsoPlugin } from "./index";

interface SetupOpts {
  initialRoute?: string;
  settings?: Partial<EnterpriseSettings>;
}

const setup = ({
  initialRoute = "/auth/login",
  settings = {},
}: SetupOpts = {}) => {
  const state = createMockState({
    settings: mockSettings({
      "enable-password-login": true,
      "google-auth-enabled": false,
      "ldap-enabled": false,
      "oidc-enabled": false,
      "jwt-enabled": false,
      ...settings,
    }),
  });

  renderWithProviders(
    <>
      <Route path="/auth/login" element={<Login />} />
      <Route path="/auth/login/:provider" element={<Login />} />
    </>,
    { storeInitialState: state, withRouter: true, initialRoute },
  );
};

describe("SSO sign-in buttons", () => {
  beforeAll(() => {
    initializeSsoPlugin();
  });

  it("shows only the password form when no single sign-on method is enabled", () => {
    setup();

    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.queryByText("Sign in with SSO")).not.toBeInTheDocument();
  });

  it("shows a button with the configured label that starts an OpenID Connect sign-in", () => {
    setup({
      initialRoute: "/auth/login?redirect=%2Fquestion%2F1",
      settings: {
        "oidc-enabled": true,
        "oidc-login-prompt": "Sign in with BCC",
      },
    });

    expect(
      screen.getByRole("link", { name: "Sign in with BCC" }),
    ).toHaveAttribute("href", "/auth/sso/oidc?redirect=%2Fquestion%2F1");
    expect(screen.getByText("Sign in with email")).toBeInTheDocument();
  });

  it("falls back to a neutral label for OpenID Connect", () => {
    setup({ settings: { "oidc-enabled": true, "oidc-login-prompt": null } });

    expect(
      screen.getByRole("link", { name: "Sign in with SSO" }),
    ).toHaveAttribute("href", "/auth/sso/oidc");
  });

  it("shows a button that starts a JWT sign-in", () => {
    setup({ settings: { "jwt-enabled": true } });

    expect(
      screen.getByRole("link", { name: "Sign in with SSO" }),
    ).toHaveAttribute("href", "/auth/sso");
  });

  it("leaves single sign-on as the only option when password login is off", () => {
    setup({
      settings: {
        "oidc-enabled": true,
        "oidc-login-prompt": "Sign in with BCC",
        "enable-password-login": false,
      },
    });

    expect(
      screen.getByRole("link", { name: "Sign in with BCC" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Sign in with email")).not.toBeInTheDocument();
  });

  it("keeps the username and password form for LDAP when password login is off", () => {
    setup({
      settings: {
        "oidc-enabled": true,
        "ldap-enabled": true,
        "enable-password-login": false,
      },
    });

    expect(
      screen.getByText("Sign in with username or email"),
    ).toBeInTheDocument();
  });

  it("explains a failed single sign-on attempt", () => {
    setup({
      initialRoute: "/auth/login?sso_error=no-account",
      settings: { "oidc-enabled": true },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "You'll need an administrator to create an account for you before you can sign in.",
    );
  });

  it("shows the identity provider's error code but never free text from the URL", () => {
    setup({
      initialRoute:
        "/auth/login?sso_error=provider&sso_error_code=access_denied",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your identity provider couldn't sign you in. (access_denied)",
    );
  });

  it("ignores an error code that isn't an OAuth error code", () => {
    setup({
      initialRoute:
        "/auth/login?sso_error=provider&sso_error_code=Call%20555-0100",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      /^Your identity provider couldn't sign you in\.$/,
    );
  });

  it("shows a generic message for an unknown error", () => {
    setup({ initialRoute: "/auth/login?sso_error=whatever" });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Something went wrong while signing you in. Please try again.",
    );
  });
});
