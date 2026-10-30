(ns metabase.data-access.schema
  "Malli schemas for the data-access module: row and column security policies (sandboxes) and connection
  impersonation policies."
  (:require
   [metabase.lib.schema.id :as lib.schema.id]
   [metabase.lib.schema.parameter :as lib.schema.parameter]
   [metabase.util :as u]
   [metabase.util.malli.registry :as mr]
   [metabase.util.malli.schema :as ms]))

(mr/def ::attribute-remappings
  "User attribute name -> the parameter target its value is applied to: a Field of the sandboxed table or of the
  sandbox question's results (`[:dimension [:field ...]]`), or a template tag of a native sandbox question
  (`[:variable [:template-tag ...]]` or `[:dimension [:template-tag ...]]`)."
  [:map-of ms/NonBlankString [:ref ::lib.schema.parameter/target]])

(mr/def ::sandbox
  "A Sandbox as selected from the app DB: every column of `:sandboxes`."
  [:merge
   ::sandbox.update
   [:map {:closed true}
    [:id ms/PositiveInt]]])

(mr/def ::sandbox.update
  "What an update (or insert) of a Sandbox accepts: every column of `:sandboxes` except `id`, all optional."
  [:map {:closed true}
   [:group_id             {:optional true} ms/PositiveInt]
   [:table_id             {:optional true} ::lib.schema.id/table]
   [:card_id              {:optional true} [:maybe ::lib.schema.id/card]]
   [:attribute_remappings {:optional true} [:maybe ::attribute-remappings]]])

(mr/def ::user-sandbox
  "A Sandbox of one of a user's groups, with the Database of its table and the last update of its question, as the
  enforcement code uses it."
  [:map
   [:id                   ms/PositiveInt]
   [:group_id             ms/PositiveInt]
   [:table_id             ::lib.schema.id/table]
   [:db_id                ::lib.schema.id/database]
   [:card_id              [:maybe ::lib.schema.id/card]]
   [:card_updated_at      {:optional true} :any]
   [:attribute_remappings [:maybe :map]]])

(mr/def ::connection-impersonation
  "A ConnectionImpersonation as selected from the app DB: every column of `:connection_impersonations`."
  [:merge
   ::connection-impersonation.update
   [:map {:closed true}
    [:id ms/PositiveInt]]])

(mr/def ::connection-impersonation.update
  "What an update (or insert) of a ConnectionImpersonation accepts: every column of `:connection_impersonations`
  except `id`, all optional."
  [:map {:closed true}
   [:db_id     {:optional true} ::lib.schema.id/database]
   [:group_id  {:optional true} ms/PositiveInt]
   [:attribute {:optional true} [:maybe ms/NonBlankString]]])

(mr/def ::sandbox.response
  "A sandbox as the `/api/mt/gtap` endpoints return it."
  [:map
   [:id                   ms/PositiveInt]
   [:group_id             ms/PositiveInt]
   [:table_id             ::lib.schema.id/table]
   [:card_id              [:maybe ::lib.schema.id/card]]
   [:attribute_remappings [:maybe [:map-of :string :any]]]
   [:permission_id        [:maybe ms/PositiveInt]]])

(mr/def ::attribute-name
  "A user attribute name. JSON object keys may arrive as keywords."
  [:schema {:decode/normalize (fn [attribute]
                                (cond-> attribute
                                  (keyword? attribute) u/qualified-name))}
   ms/NonBlankString])

(mr/def ::sandbox.request
  "A sandbox as the `/api/mt/gtap` endpoints accept it. Attribute remappings may target a Field ID, a Field name or a
  parameter target."
  [:map {:closed true}
   [:group_id             {:optional true} ms/PositiveInt]
   [:table_id             {:optional true} ::lib.schema.id/table]
   [:card_id              {:optional true} [:maybe ::lib.schema.id/card]]
   ;; a parameter target arrives as plain JSON; the sandbox code normalizes and validates it
   [:attribute_remappings {:optional true} [:maybe [:map-of
                                                    ::attribute-name
                                                    [:or
                                                     ms/PositiveInt
                                                     ms/NonBlankString
                                                     [:sequential {::mr/deliberately-open true} :any]]]]]
   [:permission_id        {:optional true} [:maybe ms/PositiveInt]]
   [:id                   {:optional true} ms/PositiveInt]])

(mr/def ::connection-impersonation.response
  "A connection impersonation policy as the `/api/mt/impersonation` endpoint returns it."
  [:map
   [:id        ms/PositiveInt]
   [:group_id  ms/PositiveInt]
   [:db_id     ::lib.schema.id/database]
   [:attribute [:maybe :string]]])
