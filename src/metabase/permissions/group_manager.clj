(ns metabase.permissions.group-manager
  "Group managers: non-admin members of a group whose membership carries the `is_group_manager` flag. A group manager
  may add people to, and remove people from, the groups they manage, and promote or demote the managers of those
  groups. These capabilities are part of the `advanced-permissions` feature; callers check that it is enabled."
  (:require
   [clojure.set :as set]
   [metabase.api.common :as api]
   [metabase.lib.schema.id :as lib.schema.id]
   [metabase.permissions.db :as permissions.db]
   [metabase.permissions.models.permissions-group :as perms-group]
   [metabase.permissions.models.permissions-group-membership :as perms-group-membership]
   [metabase.users.schema :as users.schema]
   [metabase.util :as u]
   [metabase.util.i18n :refer [tru]]
   [metabase.util.malli :as mu]
   [metabase.util.malli.schema :as ms]
   [toucan2.core :as t2]))

(set! *warn-on-reflection* true)

(mu/defn current-user-is-manager-of-group? :- :boolean
  "Whether `*current-user*` is a group manager of the group with `group-id`."
  [group-id :- ms/PositiveInt]
  (boolean
   (when-let [user-id api/*current-user-id*]
     (contains? (permissions.db/managed-group-ids user-id) group-id))))

(defn- memberships->group-id->manager?
  [memberships group-id-key]
  (into {}
        (map (juxt group-id-key (comp boolean :is_group_manager)))
        memberships))

(defn- membership-changes
  "The memberships to remove, add and re-flag to go from `old-flags` to `new-flags`, both maps of group ID -> manager
  flag."
  [old-flags new-flags]
  (let [old-ids (set (keys old-flags))
        new-ids (set (keys new-flags))]
    {:to-remove (set/difference old-ids new-ids)
     :to-add    (set/difference new-ids old-ids)
     :to-update (into #{}
                      (filter #(not= (old-flags %) (new-flags %)))
                      (set/intersection old-ids new-ids))}))

(defn- check-may-change-groups!
  "Superusers may change any membership; anyone else only memberships in the groups they manage."
  [changed-group-ids]
  (when-not api/*is-superuser?*
    (let [managed (if api/*current-user-id*
                    (permissions.db/managed-group-ids api/*current-user-id*)
                    #{})]
      (api/check-403 (set/subset? changed-group-ids managed)))))

(defn- check-no-admin-managers!
  "Members of the Administrators group already manage everything, so they can't be group managers."
  [new-flags]
  (when (and (contains? new-flags (u/the-id (perms-group/admin)))
             (some true? (vals new-flags)))
    (throw (ex-info (tru "Admin cannot be a group manager.")
                    {:status-code 400}))))

(mu/defn set-user-group-memberships!
  "Make the group memberships of the user with `user-id` equal `new-memberships`: maps of group `:id` and
  `:is_group_manager` (absent means `false`). Superusers may make any change; anyone else gets a 403 unless every
  group whose membership changes is one they manage."
  [user-id         :- ::lib.schema.id/user
   new-memberships :- [:sequential ::users.schema/user-group-membership]]
  (let [old-flags (memberships->group-id->manager? (permissions.db/memberships-for-user user-id) :group_id)
        new-flags (memberships->group-id->manager? new-memberships :id)
        {:keys [to-remove to-add to-update]} (membership-changes old-flags new-flags)]
    (check-may-change-groups! (set/union to-remove to-add to-update))
    (check-no-admin-managers! new-flags)
    (when (seq (set/union to-remove to-add to-update))
      (t2/with-transaction [_conn]
        (perms-group-membership/remove-user-from-groups! user-id to-remove)
        (perms-group-membership/add-users-to-groups! (for [group-id to-add]
                                                       {:user              user-id
                                                        :group             group-id
                                                        :is-group-manager? (new-flags group-id)}))
        (doseq [group-id to-update]
          (permissions.db/set-user-group-manager! user-id group-id (new-flags group-id)))))))
