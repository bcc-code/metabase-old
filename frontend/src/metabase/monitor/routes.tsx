import { loadCodeEditor } from "metabase/common/components/CodeEditor/lazy";
import { NotFound } from "metabase/common/components/ErrorPages";
import {
  lazyModalRouteElement,
  modalRoute,
} from "metabase/common/components/ModalRoute";
import {
  canAccessContentDiagnostics,
  canAccessDependencyDiagnostics,
} from "metabase/common/monitor/selectors";
// From the file rather than the barrel beside it: the barrel also re-exports
// the page this file loads lazily, so importing the modal through it would hold
// the page in the initial bundle.
import { ModelPersistenceLogJobModal } from "metabase/monitor/tools/components/ModelPersistenceLogJobs/ModelPersistenceLogJobModal";
import {
  getNotificationsRoutes,
  getTasksRoutes,
} from "metabase/monitor/tools/routes";
import {
  PLUGIN_AUDIT,
  PLUGIN_MONITOR,
  PLUGIN_MONITOR_TOOLS,
} from "metabase/plugins";
import { useSelector } from "metabase/redux";
import type { State } from "metabase/redux/store";
import { Navigate, Route, redirect } from "metabase/router";
import * as Urls from "metabase/urls";

import {
  CanAccessAiAuditing,
  CanAccessAlertsManagement,
  CanAccessApiKeyUsage,
  CanAccessContentDiagnostics,
  CanAccessDependencyDiagnostics,
  CanAccessMonitor,
  CanAccessMonitoringTools,
  CanAccessSessionManagement,
} from "./route-guards";

/** Lands on the first Monitor section the user can access. */
function MonitorIndexRedirect() {
  const indexPath = useSelector(getMonitorIndexPath);
  return <Navigate to={indexPath} replace />;
}

/**
 * The monitor pages, in their own chunk. The access guards stay eager: a guard
 * has to decide before there is anything to show. So does the job modal, which
 * is small. The log levels modal is not, so it has a loader of its own below.
 */
const monitorLayout = () =>
  import(/* webpackChunkName: "monitor" */ "./components/MonitorLayout").then(
    ({ MonitorLayout }) => ({
      Component: MonitorLayout,
    }),
  );

const dependencyDiagnosticsSectionLayout = () =>
  import(
    /* webpackChunkName: "monitor" */ "metabase/monitor/dependency-diagnostics/DependencyDiagnosticsSectionLayout"
  ).then(({ DependencyDiagnosticsSectionLayout }) => ({
    Component: DependencyDiagnosticsSectionLayout,
  }));

const contentDiagnosticsSectionLayout = () =>
  import(
    /* webpackChunkName: "monitor" */ "metabase/monitor/content-diagnostics/ContentDiagnosticsSectionLayout"
  ).then(({ ContentDiagnosticsSectionLayout }) => ({
    Component: ContentDiagnosticsSectionLayout,
  }));

const jobInfoApp = () =>
  import(
    /* webpackChunkName: "monitor" */ "metabase/monitor/tools/components/JobInfoApp"
  ).then(({ JobInfoApp }) => ({ Component: JobInfoApp }));

const logs = () =>
  import(
    /* webpackChunkName: "monitor" */ "metabase/monitor/tools/components/Logs"
  ).then(({ Logs }) => ({
    Component: Logs,
  }));

const modelPersistenceLogPage = () =>
  import(
    /* webpackChunkName: "monitor" */ "metabase/monitor/tools/components/ModelPersistenceLogJobs/ModelPersistenceLogJobs"
  ).then(({ ModelPersistenceLogPage }) => ({
    Component: ModelPersistenceLogPage,
  }));

// The log levels modal renders a code editor, which nothing else on the logs
// page needs. Its parent route is already lazy, but a modal declared with
// `modalRoute` holds its component eagerly.
const logLevelsModal = () =>
  Promise.all([
    import(
      /* webpackChunkName: "monitor" */ "metabase/monitor/tools/components/LogLevelsModal"
    ),
    // Awaited here so the modal appears with its editor already in place,
    // rather than opening around an empty area that fills in a moment later.
    loadCodeEditor(),
  ]).then(([{ LogLevelsModal }]) => LogLevelsModal);

export function getMonitorRoutes() {
  return (
    <Route element={<CanAccessMonitor />}>
      <Route path="monitor" lazy={monitorLayout}>
        <Route index element={<MonitorIndexRedirect />} />
        {PLUGIN_MONITOR.isDependencyDiagnosticsEnabled && (
          <Route element={<CanAccessDependencyDiagnostics />}>
            <Route
              path="dependency-diagnostics"
              lazy={dependencyDiagnosticsSectionLayout}
            >
              {PLUGIN_MONITOR.getDependencyDiagnosticsRoutes()}
            </Route>
          </Route>
        )}

        {PLUGIN_MONITOR.isContentDiagnosticsEnabled && (
          <Route element={<CanAccessContentDiagnostics />}>
            <Route
              path="content-diagnostics"
              lazy={contentDiagnosticsSectionLayout}
            >
              {PLUGIN_MONITOR.getContentDiagnosticsRoutes()}
            </Route>
          </Route>
        )}

        <Route element={<CanAccessMonitoringTools />}>
          <Route path="tasks">{getTasksRoutes()}</Route>
          <Route path="jobs" lazy={jobInfoApp}>
            <Route path=":jobKey" />
          </Route>
          <Route path="logs" lazy={logs}>
            {lazyModalRouteElement("levels", logLevelsModal)}
          </Route>
          {PLUGIN_MONITOR_TOOLS.COMPONENT && (
            <Route path="errors" element={<PLUGIN_MONITOR_TOOLS.COMPONENT />} />
          )}
          <Route path="model-persistence-log" lazy={modelPersistenceLogPage}>
            {modalRoute(":jobId", ModelPersistenceLogJobModal)}
          </Route>
        </Route>

        {/* Admin-only, unlike the rest of Monitoring tools above — the page loads
            `GET /api/api-key`, superuser-only, so a non-admin with just the monitoring
            application permission would hit a 403. */}
        {PLUGIN_MONITOR.isApiKeyUsageEnabled && (
          <Route element={<CanAccessApiKeyUsage />}>
            <Route path="api-key-usage">
              {PLUGIN_MONITOR.getApiKeyUsageRoutes()}
            </Route>
          </Route>
        )}

        <Route element={<CanAccessAlertsManagement />}>
          <Route path="notifications">{getNotificationsRoutes()}</Route>
        </Route>

        {PLUGIN_MONITOR.isSessionManagementEnabled && (
          <Route element={<CanAccessSessionManagement />}>
            <Route path="sessions">
              {PLUGIN_MONITOR.getSessionManagementRoutes()}
            </Route>
          </Route>
        )}

        <Route element={<CanAccessAiAuditing />}>
          {PLUGIN_AUDIT.isAiAuditingEnabled && (
            <Route path="ai-auditing">
              {PLUGIN_AUDIT.getAiAuditingRoutes()}
            </Route>
          )}
        </Route>

        <Route path="*" element={<NotFound />} />
      </Route>
    </Route>
  );
}

// Lands on the first diagnostics section this instance provides and the user
// can open, with Tasks as the fallback.
function getMonitorIndexPath(state: State) {
  if (
    PLUGIN_MONITOR.isDependencyDiagnosticsEnabled &&
    canAccessDependencyDiagnostics(state)
  ) {
    return Urls.dependencyDiagnostics();
  }
  if (
    PLUGIN_MONITOR.isContentDiagnosticsEnabled &&
    canAccessContentDiagnostics(state)
  ) {
    return Urls.contentDiagnostics();
  }
  return Urls.monitorTasks();
}

/**
 * Legacy redirects for pages that moved into the Monitor area:
 *   - /admin/tools → /monitor
 *   - /admin/tools/help → /admin/help
 *   - /admin/metabot/usage-auditing → /monitor/ai-auditing/usage
 *
 * The Data Studio → Monitor redirect for Dependency Diagnostics lives in
 * data-studio/routes.tsx instead: it must be declared inside the Data Studio
 * region (before that subtree's catch-all) so it isn't shadowed, yet outside the
 * Data Studio access guard so it forwards every user.
 */
export function getMonitorRedirects() {
  return (
    <>
      <Route path="/admin/tools/help" element={redirect(Urls.adminHelp())} />
      <Route
        path="/admin/tools/help/*"
        element={redirect(`${Urls.adminHelp()}/*`)}
      />
      <Route
        path="/admin/tools/tasks"
        element={redirect(Urls.monitorTasks())}
      />
      <Route
        path="/admin/tools/tasks/*"
        element={redirect(`${Urls.monitorTasks()}/*`)}
      />
      <Route path="/admin/tools/jobs" element={redirect(Urls.monitorJobs())} />
      <Route
        path="/admin/tools/jobs/*"
        element={redirect(`${Urls.monitorJobs()}/*`)}
      />
      <Route path="/admin/tools/logs" element={redirect(Urls.monitorLogs())} />
      <Route
        path="/admin/tools/logs/*"
        element={redirect(`${Urls.monitorLogs()}/*`)}
      />
      <Route
        path="/admin/tools/errors"
        element={redirect(Urls.monitorErroringQuestions())}
      />
      <Route
        path="/admin/tools/model-caching"
        element={redirect(Urls.monitorModelPersistenceLog())}
      />
      <Route
        path="/admin/tools/model-caching/*"
        element={redirect(`${Urls.monitorModelPersistenceLog()}/*`)}
      />
      <Route
        path="/admin/tools/notifications"
        element={redirect(Urls.monitorNotifications())}
      />
      <Route
        path="/admin/tools/notifications/*"
        element={redirect(`${Urls.monitorNotifications()}/*`)}
      />
      <Route
        path="/admin/metabot/usage-auditing"
        element={redirect(Urls.monitorAiAuditingUsage())}
      />
      <Route
        path="/admin/metabot/usage-auditing/conversations"
        element={redirect(Urls.monitorAiAuditingConversations())}
      />
      <Route
        path="/admin/metabot/usage-auditing/conversations/*"
        element={redirect(`${Urls.monitorAiAuditingConversations()}/*`)}
      />
      <Route
        path="/admin/metabot/usage-auditing/mcp"
        element={redirect(Urls.monitorAiAuditingMcp())}
      />
      <Route
        path="/admin/metabot/usage-auditing/cli"
        element={redirect(Urls.monitorAiAuditingCli())}
      />
      <Route path="/admin/tools" element={redirect(Urls.monitor())} />
    </>
  );
}
