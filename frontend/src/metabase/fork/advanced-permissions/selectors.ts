import { getUser, getUserIsAdmin } from "metabase/current-user";
import type { AdminPathKey, State } from "metabase/redux/store";
import type { User, UserPermissions } from "metabase-types/api";

const getUserPermissions = (state: State) => getUser(state)?.permissions;

export const canAccessSettings = (state: State): boolean =>
  getUserPermissions(state)?.can_access_setting ?? false;

export const canManageSubscriptions = (state: State): boolean =>
  getUserPermissions(state)?.can_access_subscription ?? false;

export const canAccessDataModel = (state: State): boolean =>
  getUserIsAdmin(state) ||
  (getUserPermissions(state)?.can_access_data_model ?? false);

const ADMIN_PATH_PERMISSIONS: ReadonlyArray<
  [AdminPathKey, keyof UserPermissions]
> = [
  ["settings", "can_access_setting"],
  ["data-model", "can_access_data_model"],
  ["databases", "can_access_db_details"],
  ["people", "is_group_manager"],
];

/**
 * The admin sections a non-admin `user` may open: Settings with the settings
 * application permission, Table Metadata and Databases when they may manage
 * the metadata or the details of some database, and People when they manage a
 * group.
 */
export function getAllowedAdminPaths(
  user: Pick<User, "permissions"> | null | undefined,
): AdminPathKey[] {
  const permissions = user?.permissions;
  return ADMIN_PATH_PERMISSIONS.filter(
    ([, permission]) => permissions?.[permission] === true,
  ).map(([path]) => path);
}
