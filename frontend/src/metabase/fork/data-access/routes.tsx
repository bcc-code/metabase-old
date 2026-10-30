import type { ReactElement } from "react";

import { Route } from "metabase/router";

import { ImpersonationModalRoute } from "./components/ImpersonationModal";
import { SandboxModalRoute } from "./components/SandboxModal";

/** Under a group's view of the data permissions editor. */
export const getSandboxGroupViewRoutes = (): ReactElement[] => [
  <Route
    key="data-access-sandbox"
    path="segmented/table/:sandboxTableId"
    element={<SandboxModalRoute view="group" />}
  />,
];

/** Under a table's view (its groups) of the data permissions editor. */
export const getSandboxDatabaseViewRoutes = (): ReactElement[] => [
  <Route
    key="data-access-sandbox"
    path="segmented/group/:sandboxGroupId"
    element={<SandboxModalRoute view="database" />}
  />,
];

/** Under a group's view (its databases) of the data permissions editor. */
export const getImpersonationGroupViewRoutes = (): ReactElement[] => [
  <Route
    key="data-access-impersonation"
    path="impersonated/database/:impersonatedDatabaseId"
    element={<ImpersonationModalRoute view="group" />}
  />,
];

/** Under a database's view (its groups) of the data permissions editor. */
export const getImpersonationDatabaseViewRoutes = (): ReactElement[] => [
  <Route
    key="data-access-impersonation"
    path="impersonated/group/:impersonatedGroupId"
    element={<ImpersonationModalRoute view="database" />}
  />,
];
