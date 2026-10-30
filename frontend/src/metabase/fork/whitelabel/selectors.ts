import { createSelector } from "@reduxjs/toolkit";

import bridgeImage from "assets/img/bridge.svg?url";
import noResultsSource from "assets/img/no_results.svg";
import type { IllustrationValue } from "metabase/plugins";
import type { State } from "metabase/redux/store";
import { getCustomIllustrationUrl, getSetting } from "metabase/settings";
import type {
  IllustrationSettingValue,
  LoadingMessage,
} from "metabase-types/api";

import { getLoadingMessageText } from "./constants";

// eslint-disable-next-line metabase/no-literal-metabase-strings -- The default application name is the product name
const DEFAULT_APPLICATION_NAME = "Metabase";

const DEFAULT_PAGE_ILLUSTRATION: IllustrationValue = {
  src: bridgeImage,
  isDefault: true,
};

type LoadingMessageFactory = (isSlow?: boolean) => string;

const LOADING_MESSAGE_FACTORIES: Record<LoadingMessage, LoadingMessageFactory> =
  {
    "doing-science": (isSlow) => getLoadingMessageText("doing-science", isSlow),
    "running-query": (isSlow) => getLoadingMessageText("running-query", isSlow),
    "loading-results": (isSlow) =>
      getLoadingMessageText("loading-results", isSlow),
  };

const getPageIllustration = (
  option: IllustrationSettingValue | undefined,
  customUrl: string | undefined,
): IllustrationValue => {
  if (option === "none") {
    return null;
  }
  if (option === "custom" && customUrl) {
    return { src: customUrl, isDefault: false };
  }
  return DEFAULT_PAGE_ILLUSTRATION;
};

const getEmptyStateIllustration = (
  option: IllustrationSettingValue | undefined,
  customUrl: string | undefined,
): string | null => {
  if (option === "none") {
    return null;
  }
  if (option === "custom" && customUrl) {
    return customUrl;
  }
  return noResultsSource;
};

export const getApplicationName = (state: State): string =>
  getSetting(state, "application-name") || DEFAULT_APPLICATION_NAME;

export const getIsWhiteLabeling = (state: State): boolean =>
  getApplicationName(state) !== DEFAULT_APPLICATION_NAME;

export const getShowMetabaseLinks = (state: State): boolean =>
  getSetting(state, "show-metabase-links") !== false;

export const getLoadingMessageFactory = (
  state: State,
): LoadingMessageFactory => {
  const loadingMessage = getSetting(state, "loading-message");
  return (
    LOADING_MESSAGE_FACTORIES[loadingMessage] ??
    LOADING_MESSAGE_FACTORIES["doing-science"]
  );
};

export const getLoginPageIllustration = createSelector(
  [
    (state: State) => getSetting(state, "login-page-illustration"),
    (state: State) =>
      getCustomIllustrationUrl(state, "login-page-illustration-custom"),
  ],
  getPageIllustration,
);

export const getLandingPageIllustration = createSelector(
  [
    (state: State) => getSetting(state, "landing-page-illustration"),
    (state: State) =>
      getCustomIllustrationUrl(state, "landing-page-illustration-custom"),
  ],
  getPageIllustration,
);

export const getNoDataIllustration = (state: State): string | null =>
  getEmptyStateIllustration(
    getSetting(state, "no-data-illustration"),
    getCustomIllustrationUrl(state, "no-data-illustration-custom"),
  );

export const getNoObjectIllustration = (state: State): string | null =>
  getEmptyStateIllustration(
    getSetting(state, "no-object-illustration"),
    getCustomIllustrationUrl(state, "no-object-illustration-custom"),
  );
