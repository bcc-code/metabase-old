(ns metabase.data-access.api.impersonation
  "`/api/mt/impersonation` endpoints: the connection impersonation policies groups have on databases. Admins only.
  Policies are created and deleted with the permissions graph (`PUT /api/permissions/graph`)."
  (:require
   [metabase.api.common :as api]
   [metabase.api.macros :as api.macros]
   [metabase.data-access.db :as data-access.db]
   [metabase.data-access.schema :as data-access.schema]
   [metabase.util.malli.schema :as ms]))

(set! *warn-on-reflection* true)

(api.macros/defendpoint :get "/" :- [:sequential ::data-access.schema/connection-impersonation.response]
  "Fetch connection impersonation policies, optionally only those of one group and/or on one database."
  [_route-params
   {group-id :group-id, db-id :db-id} :- [:map {:closed true}
                                          [:group-id {:optional true} [:maybe ms/PositiveInt]]
                                          [:db-id    {:optional true} [:maybe ms/PositiveInt]]]]
  (api/check-superuser)
  (mapv #(select-keys % [:id :group_id :db_id :attribute])
        (data-access.db/impersonations (when group-id #{group-id}) db-id)))
