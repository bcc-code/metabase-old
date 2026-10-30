(ns metabase.sso.providers.sso-oidc
  "The OpenID Connect single sign-on provider configured by the `oidc-*` settings.

  [[metabase.sso.integrations.oidc]] runs the browser side of the authorization code flow and checks the `state`
  cookie; `authenticate` here redeems the authorization code, verifies the ID token and turns its claims into user
  data, and `login!` applies the provisioning and email domain rules, then syncs group memberships.

  Users are recognized by the `sub` claim of the ID token, stored as the `provider_id` of their `sso-oidc`
  AuthIdentity, and otherwise by email address, which links an existing Metabase account on its first sign-in."
  (:require
   [clojure.string :as str]
   [metabase.auth-identity.core :as auth-identity]
   [metabase.sso.claims :as sso.claims]
   [metabase.sso.db :as sso.db]
   [metabase.sso.group-sync :as sso.group-sync]
   [metabase.sso.oidc.client :as oidc.client]
   [metabase.sso.settings :as sso.settings]
   [metabase.util :as u]
   [metabase.util.i18n :refer [tru]]
   [metabase.util.log :as log]
   [methodical.core :as methodical]))

(set! *warn-on-reflection* true)

(def provider-name
  "The `provider` of the AuthIdentity rows and sessions of OpenID Connect single sign-on."
  "sso-oidc")

(auth-identity/derive! :provider/sso-oidc :metabase.auth-identity.provider/provider)
(auth-identity/derive! :provider/sso-oidc :metabase.auth-identity.provider/create-user-if-not-exists)

(defn- email-verified?
  "Whether the `email_verified` claim (OpenID Connect Core section 5.1), when present, says the email is verified."
  [claims]
  (let [verified (get claims "email_verified")]
    (or (nil? verified) (true? verified) (= "true" verified))))

(defn claims->user-data
  "The user data for the string-keyed, verified `claims`, read with the claim paths of the `oidc-attribute-*`
  settings. Names the token doesn't carry are left out so a sign-in doesn't erase the ones Metabase has; `:groups` is
  nil when no groups claim is configured or the token has none; `:jwt_attributes` holds the claims the
  `oidc-user-attributes` setting picks, and is left out when that setting is empty."
  [claims]
  (let [first-name (sso.claims/claim-string claims (sso.settings/oidc-attribute-firstname))
        last-name  (sso.claims/claim-string claims (sso.settings/oidc-attribute-lastname))
        groups     (some->> (sso.settings/oidc-attribute-groups) (sso.claims/claim-strings claims))
        attributes (sso.claims/parse-attribute-mappings (sso.settings/oidc-user-attributes))]
    (cond-> {:email      (sso.claims/claim-string claims (sso.settings/oidc-attribute-email))
             :sso_source :oidc
             :groups     groups}
      first-name       (assoc :first_name first-name)
      last-name        (assoc :last_name last-name)
      (seq attributes) (assoc :jwt_attributes (sso.claims/claims->attributes claims attributes)))))

(defn- failure
  [error message]
  {:success? false, :error error, :message message})

(methodical/defmethod auth-identity/authenticate :provider/sso-oidc
  "Redeem the authorization `:code` of an OpenID Connect callback and verify the ID token it returns.

  The request must also carry `:redirect-uri` (the callback URI sent with the authorization request), `:oidc-nonce`
  and `:oidc-code-verifier`, both read from the state cookie of the sign-in."
  [_provider {:keys [code redirect-uri oidc-nonce oidc-code-verifier]}]
  (cond
    (not (sso.settings/oidc-enabled))
    (failure :not-enabled (tru "OpenID Connect sign-in is not enabled."))

    (str/blank? code)
    (failure :token-request-failed (tru "The identity provider did not return an authorization code."))

    (str/blank? oidc-nonce)
    (failure :invalid-state (tru "The sign-in attempt has no nonce."))

    :else
    (try
      (let [config    (oidc.client/configuration)
            tokens    (oidc.client/exchange-code config {:code          code
                                                         :redirect-uri  redirect-uri
                                                         :code-verifier oidc-code-verifier})
            claims    (oidc.client/verified-claims config tokens oidc-nonce)
            user-data (claims->user-data claims)
            sub       (get claims "sub")]
        (cond
          (not (u/email? (:email user-data)))
          (failure :email-missing (tru "The identity provider did not send an email address in the {0} claim."
                                       (sso.settings/oidc-attribute-email)))

          (not (email-verified? claims))
          (failure :email-not-verified (tru "The identity provider says the email address is not verified."))

          :else
          {:success?    true
           :claims      claims
           :user-data   user-data
           :provider-id sub
           :user-id     (sso.db/user-id-for-auth-identity provider-name sub)}))
      (catch clojure.lang.ExceptionInfo e
        (if-let [error (:sso/error (ex-data e))]
          (do (log/warnf "OpenID Connect sign-in failed (%s): %s" error (ex-message e))
              (failure error (ex-message e)))
          (throw e))))))

(methodical/defmethod auth-identity/login! :provider/sso-oidc
  "Refuse a verified sign-in whose email domain isn't allowed, or that would create an account while user provisioning
  is off; otherwise create or update the user."
  [provider request]
  (let [email (get-in request [:user-data :email])]
    (cond
      (not (true? (:success? request)))
      request

      (not (sso.settings/oidc-email-domain-allowed? email))
      (failure :email-domain-not-allowed
               (tru "Signing in with OpenID Connect is not allowed for {0}." email))

      (and (nil? (:user request))
           (not (sso.settings/oidc-user-provisioning-enabled?)))
      (failure :user-provisioning-disabled
               (tru "You''ll need an administrator to create a Metabase account before you can use OpenID Connect to log in."))

      :else
      (next-method provider request))))

(methodical/defmethod auth-identity/login! :after :provider/sso-oidc
  "Sync group memberships from the groups claim when group sync is on."
  [_provider result]
  (when (and (true? (:success? result))
             (:user result)
             (sso.settings/oidc-group-sync))
    (sso.group-sync/sync-groups! (:user result)
                                 (sso.settings/oidc-group-mappings)
                                 (get-in result [:user-data :groups])))
  result)
