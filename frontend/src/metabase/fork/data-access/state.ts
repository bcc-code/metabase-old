import {
  type PayloadAction,
  type UnknownAction,
  createSlice,
} from "@reduxjs/toolkit";

import {
  LOAD_DATA_PERMISSIONS,
  SAVE_DATA_PERMISSIONS,
} from "metabase/permissions";
import type {
  GroupTableAccessPolicyDraft,
  Impersonation,
  TableEntityId,
} from "metabase-types/api";

/** A row and column security policy edited in the permissions editor, not saved yet. */
export interface SandboxChange {
  entityId: TableEntityId;
  sandbox: GroupTableAccessPolicyDraft;
}

/**
 * Policies edited in the permissions editor. They are sent along with the
 * permissions graph when the admin saves, and dropped when the graph is
 * (re)loaded, which is also what discarding the changes does.
 */
export interface DataAccessState {
  sandboxes: SandboxChange[];
  impersonations: Impersonation[];
}

export const EMPTY_DATA_ACCESS_STATE: DataAccessState = {
  sandboxes: [],
  impersonations: [],
};

const isSuccessful =
  (type: string) =>
  (action: UnknownAction): boolean =>
    action.type === type && action.error !== true;

const dataAccessSlice = createSlice({
  name: "dataAccess",
  initialState: EMPTY_DATA_ACCESS_STATE,
  reducers: {
    sandboxChanged(state, { payload }: PayloadAction<SandboxChange>) {
      state.sandboxes = [
        ...state.sandboxes.filter(
          ({ sandbox }) =>
            sandbox.group_id !== payload.sandbox.group_id ||
            sandbox.table_id !== payload.sandbox.table_id,
        ),
        payload,
      ];
    },
    impersonationChanged(state, { payload }: PayloadAction<Impersonation>) {
      state.impersonations = [
        ...state.impersonations.filter(
          (impersonation) =>
            impersonation.group_id !== payload.group_id ||
            impersonation.db_id !== payload.db_id,
        ),
        payload,
      ];
    },
  },
  extraReducers: (builder) => {
    builder.addMatcher(
      isSuccessful(LOAD_DATA_PERMISSIONS),
      () => EMPTY_DATA_ACCESS_STATE,
    );
    builder.addMatcher(
      isSuccessful(SAVE_DATA_PERMISSIONS),
      () => EMPTY_DATA_ACCESS_STATE,
    );
  },
});

export const { sandboxChanged, impersonationChanged } = dataAccessSlice.actions;
export const dataAccessReducer = dataAccessSlice.reducer;
