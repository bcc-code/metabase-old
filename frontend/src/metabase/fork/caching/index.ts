import { PLUGIN_CACHING } from "metabase/plugins";
import type Question from "metabase-lib/v1/Question";

import { ClearCacheButton } from "./components/ClearCacheButton/ClearCacheButton";
import { DatabaseCachingEditor } from "./components/DatabaseCachingEditor/DatabaseCachingEditor";
import { MetricCachingModal } from "./components/MetricCachingModal/MetricCachingModal";
import { PreemptiveCachingSwitch } from "./components/PreemptiveCachingSwitch/PreemptiveCachingSwitch";
import {
  DashboardAndQuestionCachingTab,
  StrategyEditorForQuestionsAndDashboards,
} from "./components/QuestionsAndDashboardsCaching/QuestionsAndDashboardsCaching";
import { SidebarCacheForm } from "./components/SidebarCacheForm/SidebarCacheForm";
import { SidebarCacheSection } from "./components/SidebarCacheSection/SidebarCacheSection";
import {
  getGranularPerformanceTabMetadata,
  getGranularStrategies,
} from "./strategies";

/**
 * Saved questions and metrics can have a caching policy of their own. Models
 * are cached by persisting them instead, which their settings already offer.
 */
const hasQuestionCacheSection = (question: Question) =>
  question.isSaved() &&
  question.type() !== "model" &&
  question.canWrite() &&
  !question.isArchived();

/**
 * Fills the caching plugin slot: caching policies per database, dashboard and
 * question, with every strategy, refreshing their cached results
 * automatically, and clearing them. The backend provides granular caching
 * controls and automatic refreshing in this edition without a token.
 */
export function initializeCachingPlugin() {
  PLUGIN_CACHING.isGranularCachingEnabled = () => true;
  PLUGIN_CACHING.canOverrideRootStrategy = true;
  PLUGIN_CACHING.strategies = getGranularStrategies();
  PLUGIN_CACHING.getTabMetadata = getGranularPerformanceTabMetadata;
  PLUGIN_CACHING.hasQuestionCacheSection = hasQuestionCacheSection;
  PLUGIN_CACHING.DatabaseCachingEditor = DatabaseCachingEditor;
  PLUGIN_CACHING.SidebarCacheSection = SidebarCacheSection;
  PLUGIN_CACHING.SidebarCacheForm = SidebarCacheForm;
  PLUGIN_CACHING.InvalidateNowButton = ClearCacheButton;
  PLUGIN_CACHING.DashboardAndQuestionCachingTab =
    DashboardAndQuestionCachingTab;
  PLUGIN_CACHING.StrategyEditorForQuestionsAndDashboards =
    StrategyEditorForQuestionsAndDashboards;
  PLUGIN_CACHING.MetricCachingModal = MetricCachingModal;
  PLUGIN_CACHING.PreemptiveCachingSwitch = PreemptiveCachingSwitch;
}
