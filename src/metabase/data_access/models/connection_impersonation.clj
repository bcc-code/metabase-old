(ns metabase.data-access.models.connection-impersonation
  "Model definition for connection impersonation policies. A policy makes the queries a permissions group runs against
  a Database use a database role taken from one of the user's attributes, so the database's own access rules decide
  which rows and columns they see."
  (:require
   [methodical.core :as methodical]
   [toucan2.core :as t2]))

(set! *warn-on-reflection* true)

(methodical/defmethod t2/table-name :model/ConnectionImpersonation [_model] :connection_impersonations)

(doto :model/ConnectionImpersonation
  (derive :metabase/model))
