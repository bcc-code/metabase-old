(ns metabase.custom-viz.models.custom-visualization
  "The `:model/CustomVisualization` model: a visualization an admin installed as a single JavaScript bundle."
  (:require
   [metabase.models.interface :as mi]
   [methodical.core :as methodical]
   [toucan2.core :as t2]))

(methodical/defmethod t2/table-name :model/CustomVisualization [_model] :custom_visualization)

(doto :model/CustomVisualization
  (derive :metabase/model)
  (derive :hook/timestamped?))

(t2/deftransforms :model/CustomVisualization
  {:manifest mi/transform-json})
