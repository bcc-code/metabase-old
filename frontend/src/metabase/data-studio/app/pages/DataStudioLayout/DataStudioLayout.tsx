import { useState } from "react";
import { t } from "ttag";

import DataStudioLogo from "assets/img/data-studio-logo.svg";
import { useHasTokenFeature } from "metabase/common/hooks";
import {
  canAccessDataModel as canAccessDataModelSelector,
  getUserIsAdmin,
  useUserKeyValue,
} from "metabase/current-user";
import { useDataStudioSettings } from "metabase/data-studio/settings/hooks/use-data-studio-settings";
import {
  AreaLayout,
  AreaTab,
  AreaTabGroup,
} from "metabase/nav/components/AreaLayout";
import {
  PLUGIN_DATA_APPS,
  PLUGIN_DEPENDENCIES,
  PLUGIN_LIBRARY,
  PLUGIN_REMOTE_SYNC,
  PLUGIN_SCHEMA_VIEWER,
} from "metabase/plugins";
import { useSelector } from "metabase/redux";
import { Outlet, useLocation } from "metabase/router";
import { useSetting } from "metabase/settings";
import { canAccessTransforms as canAccessTransformsSelector } from "metabase/transforms/selectors";
import { Badge } from "metabase/ui";
import * as Urls from "metabase/urls";

import { getCurrentTab } from "./utils";

export function DataStudioLayout() {
  const {
    value: _isNavbarOpened,
    setValue: setIsNavbarOpened,
    isLoading: isLoadingNavbarKey,
  } = useUserKeyValue({
    namespace: "data_studio",
    key: "isNavbarOpened",
  });
  const isNavbarOpened = _isNavbarOpened !== false;

  const { pathname } = useLocation();
  const canAccessDataModel = useSelector(canAccessDataModelSelector);
  const canAccessTransforms = useSelector(canAccessTransformsSelector);
  const isAdmin = useSelector(getUserIsAdmin);
  const hasDirtyChanges = PLUGIN_REMOTE_SYNC.useHasLibraryDirtyChanges();
  const hasTransformDirtyChanges =
    PLUGIN_REMOTE_SYNC.useHasTransformDirtyChanges();
  const hasSnippetsDirtyChanges =
    PLUGIN_REMOTE_SYNC.useHasSnippetsDirtyChanges();
  const hasDataActionsDirtyChanges =
    PLUGIN_REMOTE_SYNC.useHasDataActionsDirtyChanges();
  const hasGlossaryDirtyChanges =
    PLUGIN_REMOTE_SYNC.useHasGlossaryDirtyChanges();
  const [isGitSettingsOpen, setIsGitSettingsOpen] = useState(false);

  // A section is listed only when this instance provides it.
  const hasLibrary = useHasTokenFeature("library") && PLUGIN_LIBRARY.isEnabled;
  const hasDependencies =
    useHasTokenFeature("dependencies") && PLUGIN_DEPENDENCIES.isEnabled;
  const hasSchemaViewer =
    useHasTokenFeature("schema-viewer") && PLUGIN_SCHEMA_VIEWER.isEnabled;
  const hasRemoteSyncFeature = useHasTokenFeature("remote_sync");

  const isTransformsSetupComplete = useSetting("transforms-setup-complete");
  const areTransformsEnabled = useSetting("transforms-enabled");

  const canUseTransforms = canAccessTransforms && areTransformsEnabled;
  // if transform setup isn't complete, we still show transforms - that's where the enable page is
  const shouldShowTransforms = canUseTransforms || !isTransformsSetupComplete;

  const settings = useDataStudioSettings();
  const currentTab = getCurrentTab(pathname);

  const upperNav = (
    <>
      <AreaTab
        label={t`Guide`}
        icon="book_open"
        to={Urls.dataStudioGuide()}
        isSelected={currentTab === "guide"}
        showLabel={isNavbarOpened}
      />

      <AreaTabGroup label={t`Data`} showLabel={isNavbarOpened}>
        {canAccessDataModel && (
          <AreaTab
            label={t`Connected data`}
            icon="database"
            to={Urls.dataStudioData()}
            isSelected={currentTab === "data"}
            showLabel={isNavbarOpened}
          />
        )}
        {shouldShowTransforms && (
          <AreaTab
            label={t`Data transformation`}
            icon="transform"
            to={Urls.transformList()}
            isSelected={currentTab === "transforms"}
            showLabel={isNavbarOpened}
            rightSection={
              hasTransformDirtyChanges &&
              PLUGIN_REMOTE_SYNC.CollectionSyncStatusBadge ? (
                <PLUGIN_REMOTE_SYNC.CollectionSyncStatusBadge />
              ) : null
            }
          />
        )}
      </AreaTabGroup>

      <AreaTabGroup label={t`Library`} showLabel={isNavbarOpened}>
        {hasLibrary && (
          <AreaTab
            label={t`Semantic layer`}
            icon="repository"
            to={Urls.dataStudioLibrary()}
            isSelected={currentTab === "library"}
            showLabel={isNavbarOpened}
            rightSection={
              hasDirtyChanges &&
              PLUGIN_REMOTE_SYNC.CollectionSyncStatusBadge ? (
                <PLUGIN_REMOTE_SYNC.CollectionSyncStatusBadge />
              ) : null
            }
          />
        )}
        {hasLibrary && (
          <AreaTab
            label={t`Dashboards`}
            icon="dashboard"
            to={Urls.dataStudioDashboards()}
            isSelected={currentTab === "dashboards"}
            showLabel={isNavbarOpened}
          />
        )}
        <AreaTab
          label={t`SQL snippets`}
          icon="snippet"
          to={Urls.dataStudioSnippets()}
          isSelected={currentTab === "snippets"}
          showLabel={isNavbarOpened}
          rightSection={
            hasSnippetsDirtyChanges &&
            PLUGIN_REMOTE_SYNC.CollectionSyncStatusBadge ? (
              <PLUGIN_REMOTE_SYNC.CollectionSyncStatusBadge />
            ) : null
          }
        />
        <AreaTab
          label={t`Data actions`}
          icon="bolt"
          to={Urls.dataStudioActions()}
          isSelected={currentTab === "actions"}
          showLabel={isNavbarOpened}
          rightSection={
            hasDataActionsDirtyChanges &&
            PLUGIN_REMOTE_SYNC.CollectionSyncStatusBadge ? (
              <PLUGIN_REMOTE_SYNC.CollectionSyncStatusBadge />
            ) : null
          }
        />
        {PLUGIN_DATA_APPS.isEnabled && isAdmin && (
          <AreaTab
            label={t`Data apps`}
            icon="app"
            to={Urls.dataStudioDataApps()}
            isSelected={currentTab === "data-apps"}
            showLabel={isNavbarOpened}
            rightSection={
              isNavbarOpened ? <Badge color="brand">{t`Beta`}</Badge> : null
            }
          />
        )}
        <AreaTab
          label={t`Glossary`}
          icon="glossary"
          to={Urls.dataStudioGlossary()}
          isSelected={currentTab === "glossary"}
          showLabel={isNavbarOpened}
          rightSection={
            hasGlossaryDirtyChanges &&
            PLUGIN_REMOTE_SYNC.CollectionSyncStatusBadge ? (
              <PLUGIN_REMOTE_SYNC.CollectionSyncStatusBadge />
            ) : null
          }
        />
      </AreaTabGroup>

      {(hasSchemaViewer || hasDependencies) && (
        <AreaTabGroup label={t`Tools`} showLabel={isNavbarOpened}>
          {hasSchemaViewer && (
            <AreaTab
              label={t`Schema viewer`}
              icon="network"
              to={Urls.dataStudioSchemaViewer()}
              isSelected={currentTab === "schema-viewer"}
              showLabel={isNavbarOpened}
            />
          )}
          {hasDependencies && (
            <AreaTab
              label={t`Dependency graph`}
              icon="dependencies"
              to={Urls.dependencyGraph()}
              isSelected={currentTab === "dependencies"}
              showLabel={isNavbarOpened}
            />
          )}
        </AreaTabGroup>
      )}
    </>
  );

  const lowerNav = (
    <>
      {hasRemoteSyncFeature && (
        <>
          <PLUGIN_REMOTE_SYNC.GitSyncSetupMenuItem
            isNavbarOpened={isNavbarOpened}
            onClick={() => setIsGitSettingsOpen(true)}
          />
          <PLUGIN_REMOTE_SYNC.GitSettingsModal
            isOpen={isGitSettingsOpen}
            onClose={() => setIsGitSettingsOpen(false)}
          />
        </>
      )}
      {settings.length > 0 && (
        <AreaTab
          label={t`Settings`}
          icon="gear"
          to={Urls.dataStudioSettings()}
          isSelected={currentTab === "settings"}
          showLabel={isNavbarOpened}
        />
      )}
    </>
  );

  return (
    <AreaLayout
      logo={
        <img
          alt={t`Data Studio Logo`}
          src={DataStudioLogo}
          width={32}
          height={32}
          style={{ display: "block" }}
        />
      }
      testId="data-studio-nav"
      isLoading={isLoadingNavbarKey}
      isNavbarOpened={isNavbarOpened}
      onNavbarToggle={setIsNavbarOpened}
      headerControls={<PLUGIN_REMOTE_SYNC.GitSyncAppBarControls />}
      upperNav={upperNav}
      lowerNav={lowerNav}
    >
      <Outlet />
    </AreaLayout>
  );
}
