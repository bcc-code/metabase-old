(ns metabase.data-access.api.gtap
  "`/api/mt/gtap` endpoints, for managing row and column security policies (sandboxes, historically \"group table
  access policies\"). Admins only."
  (:require
   [metabase.api.common :as api]
   [metabase.api.macros :as api.macros]
   [metabase.data-access.db :as data-access.db]
   [metabase.data-access.permissions-graph :as data-access.permissions-graph]
   [metabase.data-access.schema :as data-access.schema]
   [metabase.data-access.validation :as data-access.validation]
   [metabase.premium-features.core :as premium-features]
   [metabase.util.i18n :refer [tru]]
   [metabase.util.malli.schema :as ms]))

(set! *warn-on-reflection* true)

(defn- present [sandbox]
  (when sandbox
    (-> (select-keys sandbox [:id :group_id :table_id :card_id :attribute_remappings])
        (assoc :permission_id nil))))

(defn- check-sandboxes-feature []
  (premium-features/assert-has-feature :sandboxes (tru "Row and column security")))

;; `group_id` and `table_id` keep the snake_case names of the established `/api/mt/gtap` API its clients call.
#_{:clj-kondo/ignore [:metabase/validate-defendpoint-query-params-use-kebab-case]}
(api.macros/defendpoint :get "/" :- [:or
                                     [:maybe ::data-access.schema/sandbox.response]
                                     [:sequential ::data-access.schema/sandbox.response]]
  "Fetch row and column security policies. With both `group_id` and `table_id`, return the one of that group on that
  table (or nothing); otherwise the list, optionally of one group or on one table."
  [_route-params
   {:keys [group_id table_id]} :- [:map {:closed true}
                                   [:group_id {:optional true} [:maybe ms/PositiveInt]]
                                   [:table_id {:optional true} [:maybe ms/PositiveInt]]]]
  (api/check-superuser)
  (if (and group_id table_id)
    (present (data-access.db/sandbox-for-group-and-table group_id table_id))
    (mapv present (data-access.db/sandboxes group_id table_id))))

(api.macros/defendpoint :get "/:id" :- ::data-access.schema/sandbox.response
  "Fetch the row and column security policy with `id`."
  [{:keys [id]} :- [:map {:closed true} [:id ms/PositiveInt]]]
  (api/check-superuser)
  (present (api/check-404 (data-access.db/sandbox id))))

(api.macros/defendpoint :post "/" :- ::data-access.schema/sandbox.response
  "Create a row and column security policy for a group on a table (or update the one it has)."
  [_route-params
   _query-params
   {:keys [group_id table_id], :as body} :- ::data-access.schema/sandbox.request]
  (api/check-superuser)
  (check-sandboxes-feature)
  (api/check-400 (and group_id table_id) (tru "A group_id and a table_id are required."))
  (present (data-access.permissions-graph/upsert-sandbox!
            (-> (select-keys body [:card_id :attribute_remappings])
                (assoc :group_id group_id :table_id table_id)))))

(api.macros/defendpoint :put "/:id" :- ::data-access.schema/sandbox.response
  "Update the question and/or attribute remappings of the row and column security policy with `id`."
  [{:keys [id]} :- [:map {:closed true} [:id ms/PositiveInt]]
   _query-params
   body :- ::data-access.schema/sandbox.request]
  (api/check-superuser)
  (check-sandboxes-feature)
  (api/check-404 (data-access.db/sandbox id))
  (present (data-access.permissions-graph/upsert-sandbox!
            (assoc (select-keys body [:card_id :attribute_remappings]) :id id))))

(api.macros/defendpoint :delete "/:id" :- :nil
  "Delete the row and column security policy with `id`. The group's view-data permission on the table stays
  unrestricted; change it in the permissions editor."
  [{:keys [id]} :- [:map {:closed true} [:id ms/PositiveInt]]]
  (api/check-superuser)
  (api/check-404 (data-access.db/sandbox id))
  (data-access.db/delete-sandbox! id)
  nil)

(api.macros/defendpoint :post "/validate" :- :nil
  "Check that a row and column security policy is valid without saving it: responds 400 with the problem otherwise."
  [_route-params
   _query-params
   {:keys [table_id card_id attribute_remappings]} :- ::data-access.schema/sandbox.request]
  (api/check-superuser)
  (api/check-400 table_id (tru "A table_id is required."))
  (data-access.validation/check-sandbox!
   {:table_id             table_id
    :card_id              card_id
    :attribute_remappings (data-access.permissions-graph/normalize-attribute-remappings
                           table_id card_id attribute_remappings)})
  nil)
