(ns metabase.data-access.api.user
  "`/api/mt/user` endpoints: the user attributes row and column security and connection impersonation can use."
  (:require
   [clojure.string :as str]
   [metabase.api.common :as api]
   [metabase.api.macros :as api.macros]
   [metabase.data-access.db :as data-access.db]))

(set! *warn-on-reflection* true)

(api.macros/defendpoint :get "/attributes" :- [:sequential :string]
  "The names of the attributes users have (set by an admin, or received from SSO), sorted. System attributes, whose
  names start with `@`, are left out. Admins only."
  []
  (api/check-superuser)
  (->> (data-access.db/personal-user-attributes)
       (mapcat (fn [{:keys [login_attributes jwt_attributes]}]
                 (concat (keys login_attributes) (keys jwt_attributes))))
       (map name)
       (remove #(str/starts-with? % "@"))
       distinct
       sort
       vec))
