import userEvent from "@testing-library/user-event";
import fetchMock from "fetch-mock";

import { setupCurrentUserEndpoint } from "__support__/server-mocks";
import { createMockState } from "__support__/state";
import { act, renderWithProviders, screen, waitFor } from "__support__/ui";
import { Route } from "metabase/router";
import type { Membership } from "metabase-types/api";
import { createMockUser } from "metabase-types/api/mocks";

import { UserTypeCell } from "./UserTypeCell";
import { UserTypeToggle } from "./UserTypeToggle";
import {
  deleteGroup,
  getChangeMembershipConfirmation,
  getRemoveMembershipConfirmation,
} from "./membership";

const MANAGER = createMockUser({ id: 10, is_superuser: false });
const ADMIN = createMockUser({ id: 1, is_superuser: true });

const MANAGER_MEMBERSHIP: Membership = {
  user_id: MANAGER.id,
  group_id: 3,
  membership_id: 30,
  is_group_manager: true,
};
const OTHER_MEMBERSHIP: Membership = {
  user_id: 11,
  group_id: 3,
  membership_id: 31,
  is_group_manager: true,
};

describe("getChangeMembershipConfirmation", () => {
  it("asks managers to confirm demoting themselves", () => {
    expect(
      getChangeMembershipConfirmation(MANAGER, {
        ...MANAGER_MEMBERSHIP,
        is_group_manager: false,
      }),
    ).toEqual({
      title: "Are you sure?",
      message: "You will not be able to manage users of this group anymore.",
    });
  });

  it("doesn't ask when demoting someone else, or for admins", () => {
    expect(
      getChangeMembershipConfirmation(MANAGER, {
        ...OTHER_MEMBERSHIP,
        is_group_manager: false,
      }),
    ).toBeNull();
    expect(
      getChangeMembershipConfirmation(MANAGER, MANAGER_MEMBERSHIP),
    ).toBeNull();
    expect(
      getChangeMembershipConfirmation(ADMIN, {
        ...MANAGER_MEMBERSHIP,
        user_id: ADMIN.id,
        is_group_manager: false,
      }),
    ).toBeNull();
  });
});

describe("getRemoveMembershipConfirmation", () => {
  it("asks managers to confirm leaving a group they manage", () => {
    expect(
      getRemoveMembershipConfirmation(
        MANAGER,
        [MANAGER_MEMBERSHIP],
        MANAGER_MEMBERSHIP.membership_id,
      ),
    ).toEqual({
      title: "Are you sure?",
      message: "You will not be able to manage users of this group anymore.",
    });
  });

  it("doesn't ask when removing someone else", () => {
    expect(
      getRemoveMembershipConfirmation(
        MANAGER,
        [MANAGER_MEMBERSHIP],
        OTHER_MEMBERSHIP.membership_id,
      ),
    ).toBeNull();
    expect(
      getRemoveMembershipConfirmation(
        MANAGER,
        undefined,
        OTHER_MEMBERSHIP.membership_id,
      ),
    ).toBeNull();
  });
});

describe("UserTypeToggle", () => {
  it("promotes a member without toggling the row it sits in", async () => {
    const onChange = jest.fn();
    const onRowClick = jest.fn();
    renderWithProviders(
      <div onClick={onRowClick}>
        <UserTypeToggle isManager={false} onChange={onChange} />
      </div>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Turn into Manager" }),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("demotes a manager", async () => {
    const onChange = jest.fn();
    renderWithProviders(<UserTypeToggle isManager onChange={onChange} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Turn into Member" }),
    );

    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe("UserTypeCell", () => {
  const renderCell = (props: { isManager: boolean; isAdmin: boolean }) =>
    renderWithProviders(
      <table>
        <tbody>
          <tr>
            <UserTypeCell {...props} onChange={jest.fn()} />
          </tr>
        </tbody>
      </table>,
    );

  it("shows managers and members with a toggle", () => {
    renderCell({ isManager: true, isAdmin: false });
    expect(screen.getByText("Manager")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Turn into Member" }),
    ).toBeInTheDocument();
  });

  it("shows admins without a toggle", () => {
    renderCell({ isManager: false, isAdmin: true });
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("deleteGroup", () => {
  it("deletes the group and sends a manager home when it was their last group", async () => {
    fetchMock.delete("path:/api/permissions/group/3", 204);
    setupCurrentUserEndpoint(MANAGER);
    const { store, router } = renderWithProviders(
      <Route path="*" element={<div />} />,
      {
        storeInitialState: createMockState({ currentUser: MANAGER }),
        withRouter: true,
        initialRoute: "/admin/people/groups",
      },
    );

    await act(async () => {
      await store.dispatch(deleteGroup({ id: 3 }, 1));
    });

    await waitFor(() => expect(router?.location.pathname).toBe("/"));
    expect(
      fetchMock.callHistory.calls("path:/api/permissions/group/3", {
        method: "DELETE",
      }),
    ).toHaveLength(1);
    expect(fetchMock.callHistory.calls("path:/api/user/current")).toHaveLength(
      1,
    );
  });

  it("doesn't reload an admin's permissions", async () => {
    fetchMock.delete("path:/api/permissions/group/3", 204);
    setupCurrentUserEndpoint(ADMIN);
    const { store } = renderWithProviders(<div />, {
      storeInitialState: createMockState({ currentUser: ADMIN }),
      withRouter: true,
    });

    await store.dispatch(deleteGroup({ id: 3 }, 1));

    expect(
      fetchMock.callHistory.calls("path:/api/permissions/group/3", {
        method: "DELETE",
      }),
    ).toHaveLength(1);
    expect(fetchMock.callHistory.calls("path:/api/user/current")).toHaveLength(
      0,
    );
  });
});
