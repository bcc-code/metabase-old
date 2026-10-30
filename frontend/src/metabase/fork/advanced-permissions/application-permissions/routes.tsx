import { Route } from "metabase/router";

const applicationPermissionsPage = () =>
  import(
    /* webpackChunkName: "admin-permissions" */ "./ApplicationPermissionsPage"
  ).then(({ ApplicationPermissionsPage }) => ({
    Component: ApplicationPermissionsPage,
  }));

export const getApplicationPermissionsRoutes = () => (
  <Route path="application" lazy={applicationPermissionsPage} />
);
