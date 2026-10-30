import { t } from "ttag";

import { permissionApi } from "metabase/api";
import { getUserIsAdmin, refetchCurrentUser } from "metabase/current-user";
import type { DispatchFn } from "metabase/redux";
import type { State } from "metabase/redux/store";
import { navigate } from "metabase/router";
import type { Group, GroupId, Membership, User } from "metabase-types/api";

type MembershipView = "group" | "people";

const getLosingManagerAccessConfirmation = () => ({
  title: t`Are you sure?`,
  message: t`You will not be able to manage users of this group anymore.`,
});

/**
 * Asks a group manager to confirm demoting themselves, which takes away their
 * access to the group.
 */
export function getChangeMembershipConfirmation(
  currentUser: User,
  updatedMembership: Membership,
) {
  const isDemotingThemselves =
    !currentUser.is_superuser &&
    updatedMembership.user_id === currentUser.id &&
    !updatedMembership.is_group_manager;

  return isDemotingThemselves ? getLosingManagerAccessConfirmation() : null;
}

/**
 * Asks a group manager to confirm leaving a group they manage, which takes
 * away their access to it.
 */
export function getRemoveMembershipConfirmation(
  currentUser: User,
  currentUserMemberships: Membership[] | undefined,
  deletedMembershipId: number,
) {
  const deletedMembership = currentUserMemberships?.find(
    (membership) => membership.membership_id === deletedMembershipId,
  );
  const isLeavingManagedGroup =
    !currentUser.is_superuser && deletedMembership?.is_group_manager === true;

  return isLeavingManagedGroup ? getLosingManagerAccessConfirmation() : null;
}

function getRemainingManagedGroupIds(
  currentUserMemberships: Membership[] | undefined,
  lostGroupId: GroupId,
) {
  return (currentUserMemberships ?? [])
    .filter(
      (membership) =>
        membership.is_group_manager && membership.group_id !== lostGroupId,
    )
    .map((membership) => membership.group_id);
}

/**
 * Once a group manager has given up managing `lostGroupId`, reload their
 * permissions and leave the pages they can no longer see.
 */
async function leaveLostGroup(
  dispatch: DispatchFn,
  currentUserMemberships: Membership[] | undefined,
  lostGroupId: GroupId,
  view: MembershipView,
) {
  await dispatch(refetchCurrentUser());
  const remainingGroupIds = getRemainingManagedGroupIds(
    currentUserMemberships,
    lostGroupId,
  );

  if (remainingGroupIds.length === 0) {
    navigate("/");
  } else if (view === "group") {
    navigate("/admin/people/groups");
  }
}

export const confirmUpdateMembershipAction =
  (
    membership: Membership,
    currentUserMemberships: Membership[] | undefined,
    view: MembershipView = "group",
  ) =>
  async (dispatch: DispatchFn) => {
    await dispatch(
      permissionApi.endpoints.updateMembership.initiate(membership),
    ).unwrap();
    await leaveLostGroup(
      dispatch,
      currentUserMemberships,
      membership.group_id,
      view,
    );
  };

export const confirmDeleteMembershipAction =
  (
    membership: Membership,
    currentUserMemberships: Membership[] | undefined,
    view: MembershipView = "group",
  ) =>
  async (dispatch: DispatchFn) => {
    await dispatch(
      permissionApi.endpoints.deleteMembership.initiate(membership),
    ).unwrap();
    await leaveLostGroup(
      dispatch,
      currentUserMemberships,
      membership.group_id,
      view,
    );
  };

/**
 * Deletes a group. When a group manager deletes the last group they manage,
 * they lose access to the People pages, so they're sent home.
 */
export const deleteGroup =
  (group: Pick<Group, "id">, groupCount: number) =>
  async (dispatch: DispatchFn, getState: () => State) => {
    await dispatch(
      permissionApi.endpoints.deletePermissionsGroup.initiate(group.id),
    ).unwrap();

    if (!getUserIsAdmin(getState()) && groupCount <= 1) {
      await dispatch(refetchCurrentUser());
      navigate("/");
    }
  };
