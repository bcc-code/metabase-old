(ns metabase.data-access.db
  "Application database queries for the data-access module. Every function here is a direct Toucan 2 call with no
  additional logic, so the rest of the module never talks to `toucan2.core` itself (apart from model definitions)."
  (:require
   [metabase.data-access.schema :as data-access.schema]
   [metabase.lib.schema.id :as lib.schema.id]
   [metabase.util.malli :as mu]
   [metabase.util.malli.schema :as ms]
   [metabase.warehouse-schema-overlay.core :as warehouse-schema-overlay]
   [toucan2.core :as t2]))

(set! *warn-on-reflection* true)

;;; ------------------------------------------------- Tables ---------------------------------------------------------

(mu/defn table :- [:maybe :map]
  "The `:id`, `:db_id`, `:schema` and `:name` of the Table with `table-id`, or nil."
  [table-id :- ::lib.schema.id/table]
  (t2/select-one [:model/Table :id :db_id :schema :name] :id [:auto/param table-id]
                 {:from [(warehouse-schema-overlay/table-query {:user-settings? false})]}))

(mu/defn tables :- [:sequential :map]
  "The `:id`, `:db_id`, `:schema` and `:name` of the Tables with `table-ids`."
  [table-ids :- [:maybe [:or [:set ::lib.schema.id/table] [:sequential ::lib.schema.id/table]]]]
  (if (empty? table-ids)
    []
    (t2/select [:model/Table :id :db_id :schema :name] :id [:in (set table-ids)]
               {:from [(warehouse-schema-overlay/table-query {:user-settings? false})]})))

(mu/defn database-tables :- [:sequential :map]
  "The `:id`, `:db_id` and `:schema` of every Table of the Databases with `db-ids`, active or not."
  [db-ids :- [:maybe [:or [:set ::lib.schema.id/database] [:sequential ::lib.schema.id/database]]]]
  (if (empty? db-ids)
    []
    (t2/select [:model/Table :id :db_id :schema] :db_id [:in (set db-ids)]
               {:from [(warehouse-schema-overlay/table-query {:user-settings? false})]})))

;;; ------------------------------------------------ Sandboxes -------------------------------------------------------

(mu/defn sandbox :- [:maybe :map]
  "The Sandbox with `sandbox-id`, or nil."
  [sandbox-id :- ms/PositiveInt]
  (t2/select-one :model/Sandbox :id [:auto/param sandbox-id]))

(mu/defn sandbox-for-group-and-table :- [:maybe :map]
  "The Sandbox of the group with `group-id` on the Table with `table-id`, or nil."
  [group-id :- ms/PositiveInt
   table-id :- ::lib.schema.id/table]
  (t2/select-one :model/Sandbox :group_id [:auto/param group-id] :table_id [:auto/param table-id]))

(mu/defn sandboxes :- [:sequential :map]
  "Every Sandbox, or those of the group with `group-id` and/or on the Table with `table-id`, ordered by ID."
  [group-id :- [:maybe ms/PositiveInt]
   table-id :- [:maybe ::lib.schema.id/table]]
  (t2/select :model/Sandbox {:where    [:and
                                        (when group-id [:= :group_id [:auto/param group-id]])
                                        (when table-id [:= :table_id [:auto/param table-id]])]
                             :order-by [[:id :asc]]}))

(mu/defn sandboxes-with-database :- [:sequential :map]
  "Every Sandbox, with the `:db_id` and `:schema` of its Table, optionally only those of `group-ids` and/or on Tables
  of the Database with `db-id`."
  [group-ids :- [:maybe [:or [:set ms/PositiveInt] [:sequential ms/PositiveInt]]]
   db-id     :- [:maybe ::lib.schema.id/database]]
  (if (and (some? group-ids) (empty? group-ids))
    []
    (t2/select :model/Sandbox
               {:select   [:s.id :s.group_id :s.table_id :s.card_id :s.attribute_remappings :t.db_id :t.schema]
                :from     [[:sandboxes :s]]
                :join     [[:metabase_table :t] [:= :t.id :s.table_id]]
                :where    [:and
                           (when (seq group-ids) [:in :s.group_id (set group-ids)])
                           (when db-id [:= :t.db_id [:auto/param db-id]])]
                :order-by [[:s.id :asc]]})))

(mu/defn user-sandboxes :- [:sequential :map]
  "The Sandboxes of every group the User with `user-id` belongs to, with the `:db_id` of each sandboxed Table and the
  `:card_updated_at` of each sandbox question."
  [user-id :- ::lib.schema.id/user]
  (t2/select :model/Sandbox
             {:select [:s.id :s.group_id :s.table_id :s.card_id :s.attribute_remappings :t.db_id
                       [:c.updated_at :card_updated_at]]
              :from   [[:sandboxes :s]]
              :join   [[:permissions_group_membership :pgm] [:= :pgm.group_id :s.group_id]
                       [:metabase_table :t]                 [:= :t.id :s.table_id]]
              :left-join [[:report_card :c] [:= :c.id :s.card_id]]
              :where  [:= :pgm.user_id [:auto/param user-id]]}))

(mu/defn sandboxes-using-card :- [:sequential :map]
  "The Sandboxes whose question is the Card with `card-id`."
  [card-id :- ::lib.schema.id/card]
  (t2/select :model/Sandbox :card_id [:auto/param card-id]))

(mu/defn sandboxed-group-ids-in-database :- [:set ms/PositiveInt]
  "The IDs of those of `group-ids` with a Sandbox on any Table of the Database with `db-id`."
  [db-id     :- ::lib.schema.id/database
   group-ids :- [:or [:set ms/PositiveInt] [:sequential ms/PositiveInt]]]
  (if (empty? group-ids)
    #{}
    (or (t2/select-fn-set :group_id :model/Sandbox
                          {:select [:s.group_id]
                           :from   [[:sandboxes :s]]
                           :join   [[:metabase_table :t] [:= :t.id :s.table_id]]
                           :where  [:and
                                    [:= :t.db_id [:auto/param db-id]]
                                    [:in :s.group_id (set group-ids)]]})
        #{})))

(mu/defn insert-sandbox! :- :map
  "Insert a Sandbox and return it."
  [sandbox :- ::data-access.schema/sandbox.update]
  (t2/insert-returning-instance! :model/Sandbox sandbox))

(mu/defn update-sandbox! :- :int
  "Update the Sandbox with `sandbox-id` with `changes`, returning the number of rows updated."
  [sandbox-id :- ms/PositiveInt
   changes    :- ::data-access.schema/sandbox.update]
  (t2/update! :model/Sandbox :id [:auto/param sandbox-id] changes))

(mu/defn delete-sandbox! :- :int
  "Delete the Sandbox with `sandbox-id`, returning the number of rows deleted."
  [sandbox-id :- ms/PositiveInt]
  (t2/delete! :model/Sandbox :id [:auto/param sandbox-id]))

(mu/defn delete-sandboxes-by-ids! :- :int
  "Delete the Sandboxes with `sandbox-ids`, returning the number of rows deleted."
  [sandbox-ids :- [:maybe [:or [:set ms/PositiveInt] [:sequential ms/PositiveInt]]]]
  (if (empty? sandbox-ids)
    0
    (t2/delete! :model/Sandbox :id [:in (set sandbox-ids)])))

;;; ----------------------------------------- Connection impersonations ----------------------------------------------

(mu/defn impersonations :- [:sequential :map]
  "Every ConnectionImpersonation, or those of `group-ids` and/or on the Database with `db-id`, ordered by ID."
  [group-ids :- [:maybe [:or [:set ms/PositiveInt] [:sequential ms/PositiveInt]]]
   db-id     :- [:maybe ::lib.schema.id/database]]
  (if (and (some? group-ids) (empty? group-ids))
    []
    (t2/select :model/ConnectionImpersonation
               {:where    [:and
                           (when (seq group-ids) [:in :group_id (set group-ids)])
                           (when db-id [:= :db_id [:auto/param db-id]])]
                :order-by [[:id :asc]]})))

(mu/defn user-impersonations :- [:sequential :map]
  "The ConnectionImpersonations of every group the User with `user-id` belongs to on the Database with `db-id`, or on
  every Database when `db-id` is nil."
  [user-id :- ::lib.schema.id/user
   db-id   :- [:maybe ::lib.schema.id/database]]
  (t2/select :model/ConnectionImpersonation
             {:select [:ci.id :ci.db_id :ci.group_id :ci.attribute]
              :from   [[:connection_impersonations :ci]]
              :join   [[:permissions_group_membership :pgm] [:= :pgm.group_id :ci.group_id]]
              :where  [:and
                       [:= :pgm.user_id [:auto/param user-id]]
                       (when db-id [:= :ci.db_id [:auto/param db-id]])]}))

(mu/defn database-has-impersonations? :- :boolean
  "Whether any group has a ConnectionImpersonation on the Database with `db-id`."
  [db-id :- ::lib.schema.id/database]
  (t2/exists? :model/ConnectionImpersonation :db_id [:auto/param db-id]))

(mu/defn insert-impersonation! :- :map
  "Insert a ConnectionImpersonation and return it."
  [impersonation :- ::data-access.schema/connection-impersonation.update]
  (t2/insert-returning-instance! :model/ConnectionImpersonation impersonation))

(mu/defn delete-impersonations! :- :int
  "Delete the ConnectionImpersonations of the group with `group-id` on the Database with `db-id`, returning the number
  of rows deleted."
  [group-id :- ms/PositiveInt
   db-id    :- ::lib.schema.id/database]
  (t2/delete! :model/ConnectionImpersonation :group_id [:auto/param group-id] :db_id [:auto/param db-id]))

;;; ------------------------------------------------ Users -----------------------------------------------------------

(mu/defn user-group-ids :- [:set ms/PositiveInt]
  "The IDs of the groups the User with `user-id` belongs to."
  [user-id :- ::lib.schema.id/user]
  (or (t2/select-fn-set :group_id :model/PermissionsGroupMembership :user_id [:auto/param user-id])
      #{}))

(mu/defn user-attribute-columns :- [:maybe :map]
  "The `:type`, `:tenant_id`, `:login_attributes` and `:jwt_attributes` of the User with `user-id`, or nil."
  [user-id :- ::lib.schema.id/user]
  (t2/select-one [:model/User :id :type :tenant_id :login_attributes :jwt_attributes] :id [:auto/param user-id]))

(mu/defn personal-user-attributes :- [:sequential :map]
  "The `:login_attributes` and `:jwt_attributes` of every personal User that has any."
  []
  (t2/select [:model/User :login_attributes :jwt_attributes]
             {:where [:and
                      [:= :type "personal"]
                      [:or [:not= :login_attributes nil] [:not= :jwt_attributes nil]]]}))
