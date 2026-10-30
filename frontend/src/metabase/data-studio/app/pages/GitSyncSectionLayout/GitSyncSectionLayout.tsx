import { t } from "ttag";

import { PageContainer } from "metabase/common/data-studio/components/PageContainer";
import { usePageTitle } from "metabase/hooks/use-page-title";
import { PLUGIN_REMOTE_SYNC } from "metabase/plugins";
import { Box } from "metabase/ui";

export function GitSyncSectionLayout() {
  usePageTitle(t`Git sync`);

  return (
    <PageContainer>
      <Box maw="60rem" w="100%" mx="auto" py="lg">
        <PLUGIN_REMOTE_SYNC.RemoteSyncSettings />
      </Box>
    </PageContainer>
  );
}
