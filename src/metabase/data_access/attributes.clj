(ns metabase.data-access.attributes
  "User attributes as row and column security and connection impersonation read them."
  (:require
   [metabase.api.common :as api]
   [metabase.data-access.db :as data-access.db]
   [metabase.tenants.core :as tenants]
   [metabase.util.i18n :refer [tru]]))

(set! *warn-on-reflection* true)

(defn user-attributes
  "The attributes of the User with `user-id`: its tenant's, then its SSO (JWT) attributes, then the ones an admin set,
  later ones winning. Only personal users have attributes; anyone else (API keys, internal users) has none, so a policy
  that needs one fails rather than reading attributes stored on a non-personal user row."
  [user-id]
  (let [current @api/*current-user*]
    (if (and current (= (:id current) user-id) (contains? current :attributes))
      (or (:attributes current) {})
      (if-let [user (when user-id (data-access.db/user-attribute-columns user-id))]
        (if (= (keyword (:type user)) :personal)
          (merge {} (tenants/login-attributes user) (:jwt_attributes user) (:login_attributes user))
          {})
        {}))))

(defn required-attribute-value
  "The value of `attribute` for the user with `attributes`, or throws a 403 naming the missing attribute. `policy` names
  the kind of policy that needs it, for the message."
  [attributes attribute policy]
  (let [value (get attributes attribute)]
    (when (or (nil? value)
              (and (string? value) (= "" value))
              (and (sequential? value) (empty? value)))
      (throw (ex-info (case policy
                        :sandbox       (tru "Your data access is restricted by row and column security, which requires the user attribute \"{0}\", but you don''t have it. Ask an administrator to set it."
                                            attribute)
                        :impersonation (tru "Your data access uses connection impersonation, which requires the user attribute \"{0}\", but you don''t have it. Ask an administrator to set it."
                                            attribute))
                      {:status-code 403
                       :type        :missing-required-permissions
                       :attribute   attribute})))
    value))
