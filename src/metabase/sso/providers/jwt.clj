(ns metabase.sso.providers.jwt
  "The JWT single sign-on provider configured by the `jwt-*` settings.

  The identity provider signs a token with the shared secret and sends the user back to `/auth/sso?jwt=...`;
  `authenticate` here verifies the token and reads the user's details from its claims, and `login!` applies the
  provisioning rule, then syncs group memberships. Users are matched by email address."
  (:require
   [clojure.string :as str]
   [metabase.auth-identity.core :as auth-identity]
   [metabase.sso.claims :as sso.claims]
   [metabase.sso.group-sync :as sso.group-sync]
   [metabase.sso.jwt :as sso.jwt]
   [metabase.sso.settings :as sso.settings]
   [metabase.util :as u]
   [metabase.util.i18n :refer [tru]]
   [metabase.util.log :as log]
   [methodical.core :as methodical]))

(set! *warn-on-reflection* true)

(auth-identity/derive! :provider/jwt :metabase.auth-identity.provider/provider)
(auth-identity/derive! :provider/jwt :metabase.auth-identity.provider/create-user-if-not-exists)

(defn claims->user-data
  "The user data for the string-keyed, verified `claims`, read with the claim paths of the `jwt-attribute-*` settings.
  Names the token doesn't carry are left out so a sign-in doesn't erase the ones Metabase has; `:groups` is nil when
  the token has no groups claim; `:jwt_attributes` holds the claims the `jwt-user-attributes` setting picks, and is left
  out when that setting is empty."
  [claims]
  (let [first-name (sso.claims/claim-string claims (sso.settings/jwt-attribute-firstname))
        last-name  (sso.claims/claim-string claims (sso.settings/jwt-attribute-lastname))
        attributes (sso.claims/parse-attribute-mappings (sso.settings/jwt-user-attributes))]
    (cond-> {:email      (sso.claims/claim-string claims (sso.settings/jwt-attribute-email))
             :sso_source :jwt
             :groups     (some->> (sso.settings/jwt-attribute-groups) (sso.claims/claim-strings claims))}
      first-name       (assoc :first_name first-name)
      last-name        (assoc :last_name last-name)
      (seq attributes) (assoc :jwt_attributes (sso.claims/claims->attributes claims attributes)))))

(defn- failure
  [error message]
  {:success? false, :error error, :message message})

(methodical/defmethod auth-identity/authenticate :provider/jwt
  "Verify the JWT in `:token` and read the user's details from it."
  [_provider {:keys [token]}]
  (cond
    (not (sso.settings/jwt-enabled))
    (failure :not-enabled (tru "JWT authentication is not enabled."))

    (str/blank? token)
    (failure :invalid-token (tru "No JWT was sent."))

    :else
    (let [{:keys [valid? claims error message]} (sso.jwt/verify-token token (sso.settings/jwt-shared-secret))]
      (if-not valid?
        (do (log/warnf "JWT sign-in refused (%s): %s" error message)
            (failure :invalid-token message))
        (let [user-data (claims->user-data claims)]
          (if-not (u/email? (:email user-data))
            (failure :email-missing (tru "The JWT has no email address in the {0} claim."
                                         (sso.settings/jwt-attribute-email)))
            {:success?    true
             :claims      claims
             :user-data   user-data
             :provider-id (:email user-data)}))))))

(methodical/defmethod auth-identity/login! :provider/jwt
  "Refuse a verified sign-in that would create an account while user provisioning is off; otherwise create or update
  the user."
  [provider request]
  (cond
    (not (true? (:success? request)))
    request

    (and (nil? (:user request))
         (not (sso.settings/jwt-user-provisioning-enabled?)))
    (failure :user-provisioning-disabled
             (tru "You''ll need an administrator to create a Metabase account before you can use JWT to log in."))

    :else
    (next-method provider request)))

(methodical/defmethod auth-identity/login! :after :provider/jwt
  "Sync group memberships from the groups claim when group sync is on."
  [_provider result]
  (when (and (true? (:success? result))
             (:user result)
             (sso.settings/jwt-group-sync))
    (sso.group-sync/sync-groups! (:user result)
                                 (sso.settings/jwt-group-mappings)
                                 (get-in result [:user-data :groups])))
  result)
