(ns metabase.sso.settings
  (:require
   [clojure.string :as str]
   [metabase.config.core :as config]
   [metabase.premium-features.core :as premium-features]
   [metabase.settings.core :as setting :refer [defsetting define-multi-setting define-multi-setting-impl]]
   [metabase.sso.claims :as sso.claims]
   [metabase.startup.core :as startup]
   [metabase.util :as u]
   [metabase.util.http :as u.http]
   [metabase.util.i18n :refer [deferred-tru tru]]
   [metabase.util.json :as json]
   [metabase.util.string :as u.str]
   [ring.util.codec :as codec])
  (:import
   (com.unboundid.ldap.sdk DN)
   (java.net URI)))

(set! *warn-on-reflection* true)

(defsetting ldap-host
  (deferred-tru "Server hostname.")
  :encryption :when-encryption-key-set
  :audit :getter)

(defsetting ldap-port
  (deferred-tru "Server port, usually 389 or 636 if SSL is used.")
  :encryption :when-encryption-key-set
  :type       :integer
  :default    389
  :audit      :getter)

(defsetting ldap-security
  (deferred-tru "Use SSL, TLS or plain text.")
  :type    :keyword
  :default :none
  :audit   :raw-value
  :setter  (fn [new-value]
             (when (some? new-value)
               (assert (#{:none :ssl :starttls} (keyword new-value))))
             (setting/set-value-of-type! :keyword :ldap-security new-value)))

(defsetting ldap-trust-store
  (deferred-tru "Path to a JKS trust store of CA certificates used to validate the LDAP server''s TLS certificate. Leave blank to use the JVM default trust store.")
  :encryption :when-encryption-key-set
  :export?    false
  :audit      :getter)

(defsetting ldap-bind-dn
  (deferred-tru "The Distinguished Name to bind as (if any), this user will be used to lookup information about other users.")
  :encryption :when-encryption-key-set
  :audit :getter)

(defsetting ldap-password
  (deferred-tru "The password to bind with for the lookup user.")
  :encryption :when-encryption-key-set
  :sensitive? true
  :audit     :getter)

(defsetting ldap-user-base
  (deferred-tru "Search base for users. (Will be searched recursively)")
  :encryption :when-encryption-key-set
  :audit      :getter)

(defsetting ldap-user-filter
  (deferred-tru "User lookup filter. The placeholder '''{login}''' will be replaced by the user supplied login.")
  :default    "(&(objectClass=inetOrgPerson)(|(uid={login})(mail={login})))"
  :encryption :when-encryption-key-set
  :audit      :getter)

(defsetting ldap-attribute-email
  (deferred-tru "Attribute to use for the user''s email. (usually ''mail'', ''email'' or ''userPrincipalName'')")
  :default    "mail"
  :encryption :when-encryption-key-set
  :getter     (fn [] (u/lower-case-en (setting/get-value-of-type :string :ldap-attribute-email)))
  :audit      :getter)

(defsetting ldap-attribute-firstname
  (deferred-tru "Attribute to use for the user''s first name. (usually ''givenName'')")
  ;; kept in the getter's lower case, so an untouched value reads as the default it is
  :default    "givenname"
  :getter     (fn [] (u/lower-case-en (setting/get-value-of-type :string :ldap-attribute-firstname)))
  :encryption :when-encryption-key-set
  :audit      :getter)

(defsetting ldap-attribute-lastname
  (deferred-tru "Attribute to use for the user''s last name. (usually ''sn'')")
  :encryption :when-encryption-key-set
  :default    "sn"
  :getter     (fn [] (u/lower-case-en (setting/get-value-of-type :string :ldap-attribute-lastname)))
  :audit      :getter)

(defsetting ldap-group-sync
  (deferred-tru "Enable group membership synchronization with LDAP.")
  :type    :boolean
  :default false
  :audit   :getter)

(defsetting ldap-group-base
  (deferred-tru "Search base for groups. Not required for LDAP directories that provide a ''memberOf'' overlay, such as Active Directory. (Will be searched recursively)")
  :audit      :getter
  :encryption :when-encryption-key-set)

(defsetting ldap-group-mappings
  ;; Should be in the form: {"cn=Some Group,dc=...": [1, 2, 3]} where keys are LDAP group DNs and values are lists of
  ;; MB groups IDs
  (deferred-tru "JSON containing LDAP to Metabase group mappings.")
  :encryption :when-encryption-key-set
  :type       :json
  :cache?     false
  :default    {}
  :audit      :getter
  :getter     (fn []
                (json/decode (setting/get-value-of-type :string :ldap-group-mappings) #(DN. (str %))))
  :setter     (fn [new-value]
                (cond
                  (string? new-value)
                  (recur (json/decode new-value))

                  (map? new-value)
                  (do
                    (doseq [k (keys new-value)]
                      (when-not (instance? DN k) ; handle DN-encoded keys like we get from the `:getter`
                        (when-not (DN/isValidDN (u/qualified-name k))
                          (throw (ex-info (tru "{0} is not a valid DN. Example: {1}"
                                               (u/qualified-name k)
                                               "cn=people,ou=groups,dc=example,dc=org")
                                          {:status-code 400})))))
                    (setting/set-value-of-type! :json :ldap-group-mappings new-value)))))

(defsetting ldap-configured?
  (deferred-tru "Have the mandatory LDAP settings (host and user search base) been validated and saved?")
  :type       :boolean
  :visibility :public
  :setter     :none
  :getter     (fn [] (boolean (and (ldap-host)
                                   (ldap-user-base))))
  :doc        false)

(defsetting ldap-timeout-seconds
  (deferred-tru "Maximum time, in seconds, to wait for LDAP server before falling back to local authentication")
  :type :double
  :encryption :no
  :export? false
  :default 15.0)

;;; ------------------------------------------------ Slack Connect ------------------------------------------------

(defsetting slack-connect-client-id
  (deferred-tru "Client ID for your Slack app. Get this from https://api.slack.com/apps")
  :encryption :when-encryption-key-set
  :export?    false
  :audit      :getter)

(defsetting slack-connect-client-secret
  (deferred-tru "Client Secret for your Slack app")
  :encryption :when-encryption-key-set
  :export?    false
  :audit      :no-value
  :getter     (fn []
                (-> (setting/get-value-of-type :string :slack-connect-client-secret)
                    (u.str/mask 4))))

(defn unobfuscated-slack-connect-client-secret
  "Get the unobfuscated value of [[slack-connect-client-secret]]."
  []
  (setting/get-value-of-type :string :slack-connect-client-secret))

(def slack-connect-auth-mode-sso
  "Authentication mode for full SSO login."
  "sso")

(def slack-connect-auth-mode-link-only
  "Authentication mode for account linking only (no session creation)."
  "link-only")

(defsetting slack-connect-authentication-mode
  (deferred-tru "Controls whether Slack can be used for SSO login or just account linking. Valid values: \"sso\" or \"link-only\" (default)")
  :type       :string
  :export?    false
  :default    slack-connect-auth-mode-link-only
  :audit      :getter
  :encryption :when-encryption-key-set
  :setter     (fn [new-value]
                (when (and new-value
                           (not (contains? #{slack-connect-auth-mode-sso slack-connect-auth-mode-link-only} new-value)))
                  (throw (ex-info (tru "Invalid authentication mode. Must be \"sso\" or \"link-only\"")
                                  {:status-code 400})))
                (setting/set-value-of-type! :string :slack-connect-authentication-mode new-value)))

(defsetting slack-connect-user-provisioning-enabled
  (deferred-tru "When a user logs in via Slack Connect, create a Metabase account for them automatically if they don''t have one.")
  :type    :boolean
  :export? false
  :default true
  :getter  (fn []
             (if (= (slack-connect-authentication-mode) slack-connect-auth-mode-link-only)
               false
               (setting/get-value-of-type :boolean :slack-connect-user-provisioning-enabled)))
  :audit   :getter)

(defsetting slack-connect-attribute-team-id
  (deferred-tru "Slack OIDC claim for the team/workspace ID")
  :default    "https://slack.com/team_id"
  :export?    false
  :encryption :when-encryption-key-set
  :audit      :getter)

(defsetting slack-connect-configured
  (deferred-tru "Are the mandatory Slack Connect settings configured?")
  :type    :boolean
  :export? false
  :default false
  :setter  :none
  :getter  (fn [] (boolean
                   (and (slack-connect-client-id)
                        (slack-connect-client-secret)))))

(defsetting slack-connect-enabled
  (deferred-tru "Is Slack Connect authentication configured and enabled?")
  :type    :boolean
  :export? false
  :default false
  :audit   :getter
  :getter  (fn []
             (if (slack-connect-configured)
               (setting/get-value-of-type :boolean :slack-connect-enabled)
               false)))

;;;
;;; Google Auth
;;;

(defsetting google-auth-client-id
  (deferred-tru "Client ID for Google Sign-In.")
  :encryption :when-encryption-key-set
  :visibility :public
  :audit      :getter
  :setter     (fn [client-id]
                (if (seq client-id)
                  (let [trimmed-client-id (str/trim client-id)]
                    (when-not (str/ends-with? trimmed-client-id ".apps.googleusercontent.com")
                      (throw (ex-info (tru "Invalid Google Sign-In Client ID: must end with \".apps.googleusercontent.com\"")
                                      {:status-code 400})))
                    (setting/set-value-of-type! :string :google-auth-client-id trimmed-client-id))
                  (do
                    (setting/set-value-of-type! :string :google-auth-client-id nil)
                    (setting/set-value-of-type! :boolean :google-auth-enabled false)))))

(defsetting google-auth-configured
  (deferred-tru "Is Google Sign-In configured?")
  :type   :boolean
  :setter :none
  :getter (fn [] (boolean (google-auth-client-id))))

(defsetting google-auth-enabled
  (deferred-tru "Is Google Sign-in currently enabled?")
  :visibility :public
  :type       :boolean
  :audit      :getter
  :getter     (fn []
                (if-some [value (setting/get-value-of-type :boolean :google-auth-enabled)]
                  value
                  (boolean (google-auth-client-id))))
  :setter     (fn [new-value]
                (if-let [new-value (boolean new-value)]
                  (if-not (google-auth-client-id)
                    (throw (ex-info (tru "Google Sign-In is not configured. Please set the Client ID first.")
                                    {:status-code 400}))
                    (setting/set-value-of-type! :boolean :google-auth-enabled new-value))
                  (setting/set-value-of-type! :boolean :google-auth-enabled new-value))))

(defsetting oidc-allowed-networks
  "What networks are OIDC requests allowed to? Possible values: 'allow-all' (default), 'allow-private', or 'external-only'."
  :type :keyword
  :visibility :internal
  :default :allow-all
  :export? false
  :setter :none
  :doc (str "Set this to tighten which networks OIDC discovery and token requests may reach; it defaults to "
            "allow-all. Other values: external-only and allow-private")
  :getter (fn []
            (let [[env-var-name raw-value] (setting/env-var-source :oidc-allowed-networks)]
              (or (u.http/env-network-policy env-var-name raw-value)
                  :allow-all))))

;; Reading it throws when the environment names a policy that does not exist: a typo stops the boot rather than
;; surfacing at the first login.
(defmethod startup/def-startup-validation! ::oidc-allowed-networks [_]
  (oidc-allowed-networks))

;;;
;;; Helpers shared by the JWT and OpenID Connect settings
;;;

(defn- blank->nil
  "`s` trimmed, or nil when it is blank."
  [s]
  (when (string? s)
    (not-empty (str/trim s))))

(defn- check-http-url!
  "Throw a 400 unless `url` is an absolute `http://` or `https://` URL. `label` names the field in the message."
  [url label]
  (let [^URI uri (try (URI. url) (catch Exception _ nil))]
    (when-not (and uri
                   (contains? #{"http" "https"} (some-> (.getScheme uri) u/lower-case-en))
                   (not (str/blank? (.getHost uri))))
      (throw (ex-info (tru "{0} must be an absolute URL starting with http:// or https://." label)
                      {:status-code 400})))))

(defn- group-mappings-from-raw
  "Read the group mappings setting `setting-key` as a map of the identity provider's group names (strings, exactly as
  the provider sends them) to vectors of Metabase group IDs."
  [setting-key]
  (let [raw (setting/get-raw-value setting-key map? json/decode)]
    (into {}
          (map (fn [[group-name group-ids]]
                 [(u/qualified-name group-name) (vec group-ids)]))
          raw)))

(defn- set-group-mappings!
  "Validate and store `new-value` (a map, or its JSON) as the group mappings setting `setting-key`. Keys may arrive as
  keywords from a decoded API body; they are stored as the strings the identity provider sends."
  [setting-key new-value]
  (let [new-value (if (string? new-value) (json/decode new-value) new-value)]
    (when (and (some? new-value) (not (map? new-value)))
      (throw (ex-info (tru "Group mappings must be a JSON object of group names to lists of Metabase group IDs.")
                      {:status-code 400})))
    (let [normalized (into {}
                           (map (fn [[group-name group-ids]]
                                  (let [group-name (u/qualified-name group-name)]
                                    (when (str/blank? group-name)
                                      (throw (ex-info (tru "Group names in group mappings can''t be blank.")
                                                      {:status-code 400})))
                                    (when-not (and (sequential? group-ids) (every? pos-int? group-ids))
                                      (throw (ex-info (tru "The Metabase groups for {0} must be a list of group IDs."
                                                           group-name)
                                                      {:status-code 400})))
                                    [group-name (vec (distinct group-ids))])))
                           new-value)]
      (setting/set-value-of-type! :json setting-key (not-empty normalized)))))

;;;
;;; JWT
;;;

(def ^:private min-jwt-shared-secret-length
  "RFC 7518 (section 3.2) requires an HMAC key at least as long as the hash: 256 bits for HS256, which is 32 characters
  of a random hexadecimal or base64 string."
  32)

(defsetting jwt-identity-provider-uri
  (deferred-tru "URL of your identity provider''s login page for JWT single sign-on. Metabase sends people there to sign in.")
  :feature    :sso-jwt
  :export?    false
  :encryption :when-encryption-key-set
  :audit      :getter
  :setter     (fn [new-value]
                (let [new-value (blank->nil new-value)]
                  (when new-value
                    (check-http-url! new-value (tru "JWT identity provider URI")))
                  (setting/set-value-of-type! :string :jwt-identity-provider-uri new-value))))

(defsetting jwt-shared-secret
  (deferred-tru "String used to seed the private key used to validate JWT messages. A hexadecimal-encoded 256-bit key (i.e., a 64-character string) is strongly recommended.")
  :feature    :sso-jwt
  :export?    false
  :sensitive? true
  :encryption :when-encryption-key-set
  :setter     (fn [new-value]
                (let [new-value (blank->nil new-value)]
                  ;; an admin form that was saved without touching the secret sends back its masked value, which the
                  ;; string setter below recognises and ignores
                  (when (and new-value
                             (not (setting/obfuscated-value? new-value))
                             (< (count new-value) min-jwt-shared-secret-length))
                    (throw (ex-info (tru "The JWT signing key must be at least {0} characters long."
                                         min-jwt-shared-secret-length)
                                    {:status-code 400})))
                  (setting/set-value-of-type! :string :jwt-shared-secret new-value))))

(defsetting jwt-attribute-email
  (deferred-tru "Key to retrieve the JWT user''s email address.")
  :feature    :sso-jwt
  :export?    false
  :default    "email"
  :encryption :when-encryption-key-set
  :audit      :getter)

(defsetting jwt-attribute-firstname
  (deferred-tru "Key to retrieve the JWT user''s first name.")
  :feature    :sso-jwt
  :export?    false
  :default    "first_name"
  :encryption :when-encryption-key-set
  :audit      :getter)

(defsetting jwt-attribute-lastname
  (deferred-tru "Key to retrieve the JWT user''s last name.")
  :feature    :sso-jwt
  :export?    false
  :default    "last_name"
  :encryption :when-encryption-key-set
  :audit      :getter)

(defsetting jwt-attribute-groups
  (deferred-tru "Key to retrieve the JWT user''s groups.")
  :feature    :sso-jwt
  :export?    false
  :default    "groups"
  :encryption :when-encryption-key-set
  :audit      :getter)

(defsetting jwt-group-sync
  (deferred-tru "Enable group membership synchronization with JWT.")
  :feature :sso-jwt
  :export? false
  :type    :boolean
  :default false
  :audit   :getter)

(defsetting jwt-group-mappings
  (deferred-tru "JSON containing JWT to Metabase group mappings.")
  :feature    :sso-jwt
  :export?    false
  :type       :json
  :cache?     false
  :default    {}
  :encryption :when-encryption-key-set
  :audit      :getter
  :doc        "JSON object containing JWT to Metabase group mappings, where keys are JWT groups and values are lists of Metabase groups IDs."
  :getter     (fn [] (group-mappings-from-raw :jwt-group-mappings))
  :setter     (fn [new-value] (set-group-mappings! :jwt-group-mappings new-value)))

(defsetting jwt-user-attributes
  (deferred-tru "JWT claims to store as user attributes on every login, separated by commas or line breaks. Write name=claim to store a claim under another name.")
  :feature    :sso-jwt
  :export?    false
  :encryption :when-encryption-key-set
  :audit      :getter
  :doc        "Each entry is a claim name, or `name=claim` to store the claim under another attribute name. Claim paths can be namespaced claim names or dotted paths into nested claims. String, number and boolean values are stored as text; lists of them are joined with commas; other values are skipped. The attributes are written to the user on every JWT login, replacing the ones a previous login stored."
  :setter     (fn [new-value]
                (let [new-value (blank->nil new-value)]
                  (sso.claims/parse-attribute-mappings new-value)
                  (setting/set-value-of-type! :string :jwt-user-attributes new-value))))

(defsetting jwt-user-provisioning-enabled?
  (deferred-tru "When a user logs in via JWT, create a Metabase account for them automatically if they don''t have one.")
  :feature :sso-jwt
  :export? false
  :type    :boolean
  :default true
  :audit   :getter)

(defsetting jwt-configured
  (deferred-tru "Are the mandatory JWT settings (identity provider URI and signing key) set?")
  :feature :sso-jwt
  :export? false
  :type    :boolean
  :default false
  :setter  :none
  :getter  (fn [] (boolean (and (jwt-identity-provider-uri)
                                (jwt-shared-secret)))))

(defsetting jwt-enabled
  (deferred-tru "Is JWT authentication configured and enabled?")
  :feature    :sso-jwt
  :export?    false
  :type       :boolean
  :default    false
  :visibility :public
  :audit      :getter
  :doc        "When set to true, will enable JWT authentication with the options configured in the MB_JWT_* variables.
        This is for JWT SSO authentication, and has nothing to do with Static embedding, which is MB_EMBEDDING_SECRET_KEY."
  :getter     (fn []
                (and (jwt-configured)
                     (boolean (setting/get-value-of-type :boolean :jwt-enabled))))
  :setter     (fn [new-value]
                (let [new-value (boolean new-value)]
                  (when (and new-value (not (jwt-configured)))
                    (throw (ex-info (tru "JWT authentication is not configured. Set the identity provider URI and the signing key first.")
                                    {:status-code 400})))
                  (setting/set-value-of-type! :boolean :jwt-enabled new-value))))

;;;
;;; OpenID Connect
;;;

(def ^:private reserved-oidc-authorization-params
  "Authorization request parameters that Metabase sets itself, which the extra parameters can't override."
  #{"client_id" "code_challenge" "code_challenge_method" "nonce" "redirect_uri" "response_mode" "response_type"
    "scope" "state"})

(defn parse-oidc-authorization-params
  "Parse the extra authorization request parameters `s`, written like a URL query string
  (`audience=https://api.example.com&prompt=login`) or one `name=value` per line, into a sorted map of parameter
  names to values. Throws a 400 for a malformed pair or a parameter Metabase sets itself."
  [s]
  (into (sorted-map)
        (for [pair  (str/split (or s "") #"[&\r\n]+")
              :let  [pair (str/trim pair)]
              :when (seq pair)]
          (let [[k v]     (str/split pair #"=" 2)
                param     (some-> k codec/url-decode str/trim)
                value     (some-> v codec/url-decode str/trim)]
            (when (or (str/blank? param) (nil? value))
              (throw (ex-info (tru "Each extra authorization parameter must look like name=value, but got \"{0}\"." pair)
                              {:status-code 400})))
            (when (contains? reserved-oidc-authorization-params param)
              (throw (ex-info (tru "The authorization parameter \"{0}\" is set by Metabase and can''t be overridden." param)
                              {:status-code 400})))
            [param value]))))

(defn normalize-oidc-issuer
  "Trim `issuer` and drop a trailing `/.well-known/openid-configuration`, so an admin can paste either the issuer or the
  URL of its discovery document. Discovery works with or without a trailing slash on the issuer, and ID tokens are
  checked against the issuer the discovery document declares, so neither form has to match the provider exactly."
  [issuer]
  (some-> (blank->nil issuer)
          (str/replace #"/\.well-known/openid-configuration/?$" "")
          blank->nil))

(defn- parse-email-domains
  "The lower-cased domains in the comma- or whitespace-separated list `s`, without any leading `@`."
  [s]
  (into []
        (comp (map str/trim)
              (map #(str/replace % #"^@" ""))
              (remove str/blank?)
              (map u/lower-case-en)
              (distinct))
        (str/split (or s "") #"[,\s]+")))

(defsetting oidc-issuer-uri
  (deferred-tru "The issuer URI of your OpenID Connect provider. Metabase reads the provider''s endpoints from its discovery document at this address followed by /.well-known/openid-configuration.")
  :feature    :sso-oidc
  :export?    false
  :encryption :when-encryption-key-set
  :audit      :getter
  :setter     (fn [new-value]
                (let [new-value (normalize-oidc-issuer new-value)]
                  (when new-value
                    (check-http-url! new-value (tru "Issuer URI")))
                  (setting/set-value-of-type! :string :oidc-issuer-uri new-value))))

(defsetting oidc-client-id
  (deferred-tru "The client ID of the application registered for Metabase at your OpenID Connect provider.")
  :feature    :sso-oidc
  :export?    false
  :encryption :when-encryption-key-set
  :audit      :getter
  :setter     (fn [new-value]
                (setting/set-value-of-type! :string :oidc-client-id (blank->nil new-value))))

(defsetting oidc-client-secret
  (deferred-tru "The client secret of the application registered for Metabase at your OpenID Connect provider.")
  :feature    :sso-oidc
  :export?    false
  :sensitive? true
  :encryption :when-encryption-key-set
  :setter     (fn [new-value]
                (setting/set-value-of-type! :string :oidc-client-secret (blank->nil new-value))))

(defsetting oidc-scopes
  (deferred-tru "The scopes Metabase requests from your OpenID Connect provider, separated by spaces. The openid scope is always requested.")
  :feature    :sso-oidc
  :export?    false
  :default    "openid email profile"
  :encryption :when-encryption-key-set
  :audit      :getter
  :setter     (fn [new-value]
                (setting/set-value-of-type! :string :oidc-scopes
                                            (some->> (blank->nil new-value)
                                                     (#(str/split % #"[,\s]+"))
                                                     (remove str/blank?)
                                                     distinct
                                                     (str/join " ")))))

(defn oidc-scope-list
  "The scopes to request in an authorization request: those of the `oidc-scopes` setting, with `openid` first."
  []
  (into ["openid"]
        (comp (remove str/blank?)
              (remove #{"openid"})
              (distinct))
        (str/split (or (setting/get :oidc-scopes) "") #"[,\s]+")))

(defsetting oidc-authorization-params
  (deferred-tru "Extra parameters to add to the authorization request, written like a URL query string, for example audience=https://api.example.com&prompt=login.")
  :feature    :sso-oidc
  :export?    false
  :encryption :when-encryption-key-set
  :audit      :getter
  :setter     (fn [new-value]
                (let [new-value (blank->nil new-value)]
                  ;; refuse anything the login flow could not use, so a typo shows up when it is saved
                  (parse-oidc-authorization-params new-value)
                  (setting/set-value-of-type! :string :oidc-authorization-params new-value))))

(defsetting oidc-login-prompt
  (deferred-tru "The label of the OpenID Connect button on the sign-in page, for example \"Sign in with Example\".")
  :feature    :sso-oidc
  :export?    false
  :visibility :public
  :encryption :when-encryption-key-set
  :audit      :getter
  :setter     (fn [new-value]
                (setting/set-value-of-type! :string :oidc-login-prompt (blank->nil new-value))))

(defsetting oidc-attribute-email
  (deferred-tru "The ID token or userinfo claim that holds the user''s email address. Use the full name of a namespaced claim, or a dotted path for a nested one.")
  :feature    :sso-oidc
  :export?    false
  :default    "email"
  :encryption :when-encryption-key-set
  :audit      :getter)

(defsetting oidc-attribute-firstname
  (deferred-tru "The ID token or userinfo claim that holds the user''s first name.")
  :feature    :sso-oidc
  :export?    false
  :default    "given_name"
  :encryption :when-encryption-key-set
  :audit      :getter)

(defsetting oidc-attribute-lastname
  (deferred-tru "The ID token or userinfo claim that holds the user''s last name.")
  :feature    :sso-oidc
  :export?    false
  :default    "family_name"
  :encryption :when-encryption-key-set
  :audit      :getter)

(defsetting oidc-attribute-groups
  (deferred-tru "The ID token or userinfo claim that holds the user''s groups or roles, used for group mapping.")
  :feature    :sso-oidc
  :export?    false
  :encryption :when-encryption-key-set
  :audit      :getter)

(defsetting oidc-group-sync
  (deferred-tru "Enable group membership synchronization with OpenID Connect.")
  :feature :sso-oidc
  :export? false
  :type    :boolean
  :default false
  :audit   :getter)

(defsetting oidc-group-mappings
  (deferred-tru "JSON containing OpenID Connect to Metabase group mappings.")
  :feature    :sso-oidc
  :export?    false
  :type       :json
  :cache?     false
  :default    {}
  :encryption :when-encryption-key-set
  :audit      :getter
  :doc        "JSON object whose keys are the group names your provider sends in the groups claim and whose values are lists of Metabase group IDs."
  :getter     (fn [] (group-mappings-from-raw :oidc-group-mappings))
  :setter     (fn [new-value] (set-group-mappings! :oidc-group-mappings new-value)))

(defsetting oidc-user-attributes
  (deferred-tru "ID token or userinfo claims to store as user attributes on every login, separated by commas or line breaks. Write name=claim to store a claim under another name.")
  :feature    :sso-oidc
  :export?    false
  :encryption :when-encryption-key-set
  :audit      :getter
  :doc        "Each entry is a claim name, or `name=claim` to store the claim under another attribute name. Claim paths can be namespaced claim names or dotted paths into nested claims. String, number and boolean values are stored as text; lists of them are joined with commas; other values are skipped. The attributes are written to the user on every OpenID Connect login, replacing the ones a previous login stored."
  :setter     (fn [new-value]
                (let [new-value (blank->nil new-value)]
                  (sso.claims/parse-attribute-mappings new-value)
                  (setting/set-value-of-type! :string :oidc-user-attributes new-value))))

(defsetting oidc-user-provisioning-enabled?
  (deferred-tru "When a user logs in via OpenID Connect, create a Metabase account for them automatically if they don''t have one.")
  :feature :sso-oidc
  :export? false
  :type    :boolean
  :default true
  :audit   :getter)

(defsetting oidc-allowed-email-domains
  (deferred-tru "When set, only people whose email address is from one of these comma-separated domains can sign in with OpenID Connect.")
  :feature    :sso-oidc
  :export?    false
  :encryption :when-encryption-key-set
  :audit      :getter
  :setter     (fn [new-value]
                (let [domains (parse-email-domains new-value)]
                  (when-let [bad (first (remove #(re-matches #"[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+" %)
                                                domains))]
                    (throw (ex-info (tru "{0} is not a valid email domain." bad)
                                    {:status-code 400})))
                  (setting/set-value-of-type! :string :oidc-allowed-email-domains
                                              (some->> (seq domains) (str/join ","))))))

(defn oidc-email-domain-allowed?
  "Whether `email` may sign in with OpenID Connect under the `oidc-allowed-email-domains` setting. Every address is
  allowed when the setting is empty."
  [email]
  (let [domains (parse-email-domains (setting/get :oidc-allowed-email-domains))]
    (boolean
     (or (empty? domains)
         (and (string? email)
              (some #(u/email-in-domain? (u/lower-case-en email) %) domains))))))

(defsetting oidc-configured
  (deferred-tru "Are the mandatory OpenID Connect settings (issuer URI, client ID and client secret) set?")
  :feature :sso-oidc
  :export? false
  :type    :boolean
  :default false
  :setter  :none
  :getter  (fn [] (boolean (and (oidc-issuer-uri)
                                (oidc-client-id)
                                (oidc-client-secret)))))

(defsetting oidc-enabled
  (deferred-tru "Is OpenID Connect authentication configured and enabled?")
  :feature    :sso-oidc
  :export?    false
  :type       :boolean
  :default    false
  :visibility :public
  :audit      :getter
  :getter     (fn []
                (and (oidc-configured)
                     (boolean (setting/get-value-of-type :boolean :oidc-enabled))))
  :setter     (fn [new-value]
                (let [new-value (boolean new-value)]
                  (when (and new-value (not (oidc-configured)))
                    (throw (ex-info (tru "OpenID Connect is not configured. Set the issuer URI, client ID and client secret first.")
                                    {:status-code 400})))
                  (setting/set-value-of-type! :boolean :oidc-enabled new-value))))

(defn- ee-sso-configured? []
  (when config/ee-available?
    (setting/get :other-sso-enabled?)))

(defn sso-enabled?
  "Any SSO provider is configured and enabled"
  []
  (boolean
   (or (google-auth-enabled)
       ;; read by keyword: `ldap-enabled` is defined in [[metabase.sso.ldap.settings]], which this namespace cannot
       ;; require
       (setting/get :ldap-enabled)
       (jwt-enabled)
       (oidc-enabled)
       (ee-sso-configured?))))

(defn sso-source-enabled?
  "Returns true if the given SSO source's authentication provider is currently enabled.
   When a provider is disabled (e.g., after license downgrade), returns false so users
   can fall back to password authentication."
  [sso-source]
  (boolean
   (case (keyword sso-source)
     :google (google-auth-enabled)
     :ldap   (setting/get :ldap-enabled)
     :jwt    (jwt-enabled)
     :oidc   (oidc-enabled)
     ;; Enterprise SSO providers: setting/get respects the :feature flag on each
     ;; setting — returning the default (false) when the feature is unlicensed (e.g.,
     ;; after license downgrade), so users aren't locked out of password reset.
     ;; Exception: :scim-enabled has no :feature guard, so it returns the stored value
     ;; regardless of license status.
     :saml   (setting/get :saml-enabled)
     :slack  (setting/get :slack-connect-enabled)
     :scim   (setting/get :scim-enabled)
     ;; Unknown sso_source -- treat as disabled to allow password reset
     false)))

(define-multi-setting google-auth-auto-create-accounts-domain
  (deferred-tru "When set, allow users to sign up on their own if their Google account email address is from this domain.")
  (fn [] (if (premium-features/enable-sso-google?) :ee :oss))
  :encryption :when-encryption-key-set)

(define-multi-setting-impl google-auth-auto-create-accounts-domain :oss
  :getter (fn [] (setting/get-value-of-type :string :google-auth-auto-create-accounts-domain))
  :setter (fn [domain]
            (when (and domain (str/includes? domain ","))
              ;; Multiple comma-separated domains requires the `:sso-google` premium feature flag
              (throw (ex-info (tru "Invalid domain") {:status-code 400})))
            (setting/set-value-of-type! :string :google-auth-auto-create-accounts-domain domain)))

;;;
;;; Common
;;;

(define-multi-setting send-new-sso-user-admin-email?
  (deferred-tru "Should new email notifications be sent to admins, for all new SSO users?")
  (fn [] (if (premium-features/enable-any-sso?)
           :ee
           :oss))
  :type :boolean)

(define-multi-setting-impl send-new-sso-user-admin-email? :oss
  :getter (constantly true)
  :setter :none)

;; This fork provides SSO (JWT and OpenID Connect) without a premium token, so `enable-any-sso?` is true and the
;; setting dispatches here: an admin can turn the notification off. Unset, it stays on, like the OSS implementation.
(define-multi-setting-impl send-new-sso-user-admin-email? :ee
  :getter (fn []
            (let [value (setting/get-value-of-type :boolean :send-new-sso-user-admin-email?)]
              (if (some? value) value true)))
  :setter (fn [new-value]
            (setting/set-value-of-type! :boolean :send-new-sso-user-admin-email? (some-> new-value boolean))))
