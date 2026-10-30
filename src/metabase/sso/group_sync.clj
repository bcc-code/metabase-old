(ns metabase.sso.group-sync
  "Group membership sync for the SSO providers whose group mappings are a setting of identity provider group names to
  Metabase group IDs (JWT and OpenID Connect)."
  (:require
   [metabase.sso.common :as sso.common]
   [metabase.util :as u]
   [metabase.util.log :as log]))

(set! *warn-on-reflection* true)

(defn mapped-group-ids
  "The IDs of the Metabase groups that the identity provider groups `group-names` map to under `mappings`, a map of
  group names to lists of Metabase group IDs. Group names match exactly, case included."
  [mappings group-names]
  (into #{} (mapcat #(get mappings %)) group-names))

(defn all-mapped-group-ids
  "The IDs of every Metabase group that appears in `mappings`."
  [mappings]
  (into #{} cat (vals mappings)))

(defn sync-groups!
  "Make `user` a member of exactly those mapped Metabase groups that the identity provider groups `group-names` map to.

  Only groups that appear in `mappings` are touched: memberships of every other group, including the Administrators
  group when it isn't mapped, stay as they are. When `group-names` is nil, because the token carried no groups claim,
  nothing changes. Errors are logged rather than thrown so a group sync problem doesn't stop a login that has already
  been verified."
  [user mappings group-names]
  (let [all-ids (all-mapped-group-ids mappings)]
    (when (and (some? group-names) (seq all-ids))
      (try
        (log/debugf "Syncing SSO groups for user %s: %s" (u/the-id user) (pr-str group-names))
        (sso.common/sync-group-memberships! user (mapped-group-ids mappings group-names) all-ids)
        (catch Exception e
          (log/errorf e "Error syncing SSO group memberships for user %s" (u/the-id user)))))))
