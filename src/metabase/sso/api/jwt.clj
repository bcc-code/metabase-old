(ns metabase.sso.api.jwt
  "`/api/sso/jwt` endpoints: the admin side of JWT single sign-on."
  (:require
   [metabase.api.common :as api]
   [metabase.api.macros :as api.macros]
   [metabase.settings.core :as setting]
   [metabase.sso.settings :as sso.settings]))

(set! *warn-on-reflection* true)

(def ^:private JWTSettings
  [:map {:closed true}
   [:jwt-enabled                    {:optional true} [:maybe :boolean]]
   [:jwt-identity-provider-uri      {:optional true} [:maybe :string]]
   [:jwt-shared-secret              {:optional true} [:maybe :string]]
   [:jwt-attribute-email            {:optional true} [:maybe :string]]
   [:jwt-attribute-firstname        {:optional true} [:maybe :string]]
   [:jwt-attribute-lastname         {:optional true} [:maybe :string]]
   [:jwt-attribute-groups           {:optional true} [:maybe :string]]
   [:jwt-user-attributes            {:optional true} [:maybe :string]]
   [:jwt-user-provisioning-enabled? {:optional true} [:maybe :boolean]]])

(api.macros/defendpoint :put "/settings" :- [:map {:closed true}
                                             [:jwt-enabled :boolean]]
  "Update the JWT settings. The other settings are saved before `jwt-enabled`, which needs the identity provider URI
  and the signing key to be set."
  [_route-params
   _query-params
   settings :- JWTSettings]
  (api/check-superuser)
  (setting/set-many! (dissoc settings :jwt-enabled))
  (sso.settings/jwt-enabled! (if (contains? settings :jwt-enabled)
                               (boolean (:jwt-enabled settings))
                               (sso.settings/jwt-enabled)))
  {:jwt-enabled (sso.settings/jwt-enabled)})
