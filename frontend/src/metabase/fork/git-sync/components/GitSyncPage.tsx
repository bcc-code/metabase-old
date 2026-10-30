import { t } from "ttag";

import { LoadingAndErrorWrapper } from "metabase/common/components/LoadingAndErrorWrapper";
import { getUserIsAdmin } from "metabase/current-user";
import { useSelector } from "metabase/redux";
import {
  SettingsPageWrapper,
  SettingsSection,
} from "metabase/settings-components";
import { Text } from "metabase/ui";

import { useGetGitSyncSettingsQuery } from "../api";

import { GitSyncChangesList } from "./GitSyncChangesList";
import { GitSyncStatusPanel } from "./GitSyncStatusPanel";
import { RepositoryForm } from "./RepositoryForm";
import { SyncedCollectionsList } from "./SyncedCollectionsList";

/**
 * Everything about Git sync on one page: export and import with what changed
 * since the last sync, the repository connection, and which collections sync.
 */
export function GitSyncPage() {
  const isAdmin = useSelector(getUserIsAdmin);

  return (
    <SettingsPageWrapper
      title={t`Git sync`}
      description={t`Keep collections in a Git repository: export what changed here as a commit, and import commits made elsewhere. A production instance can import on a schedule and keep synced content read-only.`}
    >
      {isAdmin ? (
        <GitSyncSections />
      ) : (
        <Text>{t`Only admins can set up Git sync and export or import.`}</Text>
      )}
    </SettingsPageWrapper>
  );
}

function GitSyncSections() {
  const { data: settings, isLoading, error } = useGetGitSyncSettingsQuery();

  if (isLoading || error || !settings) {
    return <LoadingAndErrorWrapper loading={isLoading} error={error} />;
  }

  return (
    <>
      {settings.enabled && (
        <SettingsSection title={t`Sync`}>
          <GitSyncStatusPanel />
          <GitSyncChangesList />
        </SettingsSection>
      )}
      <SettingsSection
        title={t`Repository`}
        description={
          settings.enabled
            ? undefined
            : t`Connect a Git repository over HTTPS. Synced content goes into the collections/ and snippets/ folders of the branch, one YAML file per item.`
        }
      >
        <RepositoryForm settings={settings} />
      </SettingsSection>
      {settings.enabled && (
        <SettingsSection
          title={t`Synced collections`}
          description={t`Choose the top-level collections to keep in Git. Everything in a synced collection is synced, with the SQL snippets it uses.`}
        >
          <SyncedCollectionsList isReadOnly={settings.type === "read-only"} />
        </SettingsSection>
      )}
    </>
  );
}
