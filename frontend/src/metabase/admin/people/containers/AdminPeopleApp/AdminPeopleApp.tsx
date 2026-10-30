import { AdminSettingsLayout } from "metabase/admin/components/AdminLayout/AdminSettingsLayout";
import { Outlet } from "metabase/router";

import { PeopleNav } from "../../components/PeopleNav";

export const AdminPeopleApp = () => {
  return (
    <AdminSettingsLayout sidebar={<PeopleNav />} maw="80rem">
      <Outlet />
    </AdminSettingsLayout>
  );
};
