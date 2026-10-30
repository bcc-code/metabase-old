(ns metabase.custom-viz.db
  "Application database queries for the custom-viz module. Every function here is a direct Toucan 2 call with no
  additional logic."
  (:require
   [metabase.custom-viz.schema :as custom-viz.schema]
   [metabase.util.malli :as mu]
   [metabase.util.malli.schema :as ms]
   [toucan2.core :as t2]))

(def ^:private columns
  "Every column except the bundle source, which only the bundle endpoint reads."
  [:model/CustomVisualization
   :id :identifier :display_name :icon :manifest :bundle_hash :enabled :created_at :updated_at])

(mu/defn custom-visualizations :- [:sequential ::custom-viz.schema/custom-visualization]
  "Every custom visualization, by display name."
  []
  (t2/select columns {:order-by [[:display_name :asc] [:id :asc]]}))

(mu/defn enabled-custom-visualizations :- [:sequential ::custom-viz.schema/custom-visualization]
  "The enabled custom visualizations, by display name."
  []
  (t2/select columns :enabled true {:order-by [[:display_name :asc] [:id :asc]]}))

(mu/defn custom-visualization :- [:maybe ::custom-viz.schema/custom-visualization]
  "The custom visualization with `id`, or nil."
  [id :- ms/PositiveInt]
  (t2/select-one columns :id [:auto/param id]))

(mu/defn custom-visualization-id-with-identifier :- [:maybe ms/PositiveInt]
  "The id of the custom visualization with `identifier`, or nil."
  [identifier :- :string]
  (t2/select-one-pk :model/CustomVisualization :identifier [:auto/param identifier]))

(mu/defn bundle :- [:maybe ::custom-viz.schema/bundle]
  "The bundle source, hash and enabled flag of the custom visualization with `id`, or nil."
  [id :- ms/PositiveInt]
  (t2/select-one [:model/CustomVisualization :bundle :bundle_hash :enabled] :id [:auto/param id]))

(mu/defn insert-custom-visualization! :- ms/PositiveInt
  "Insert a custom visualization `row` and return its id."
  [row :- ::custom-viz.schema/custom-visualization.insert]
  (t2/insert-returning-pk! :model/CustomVisualization row))

(mu/defn update-custom-visualization!
  "Apply `changes` to the custom visualization with `id`."
  [id      :- ms/PositiveInt
   changes :- ::custom-viz.schema/custom-visualization.update]
  (t2/update! :model/CustomVisualization id changes))

(mu/defn delete-custom-visualization!
  "Delete the custom visualization with `id`."
  [id :- ms/PositiveInt]
  (t2/delete! :model/CustomVisualization :id [:auto/param id]))
