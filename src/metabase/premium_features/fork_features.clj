(ns metabase.premium-features.fork-features
  "Features that this fork implements in its own open-source (AGPL) code.

  Upstream Metabase only turns these features on with a premium token, and backs them with the commercially licensed
  code under `enterprise/`. This fork ships its own independent implementations instead, outside `enterprise/`, so
  these features are always on, with or without a token.")

(def features
  "Names of the features this fork always provides, spelled the way they appear in a premium token's feature list."
  #{"advanced-permissions"
    "cache-granular-controls"
    "custom-viz"
    "disable-password-login"
    "remote-sync"
    "sandboxes"
    "sso-jwt"
    "sso-oidc"
    "whitelabel"})

(defn provides?
  "True if this fork provides `feature` (a keyword or a string) without a premium token."
  [feature]
  (contains? features (name feature)))
