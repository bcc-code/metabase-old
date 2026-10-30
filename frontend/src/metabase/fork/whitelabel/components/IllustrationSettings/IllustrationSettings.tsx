import { t } from "ttag";

import bridgeImage from "assets/img/bridge.svg?url";
import noResultsSource from "assets/img/no_results.svg";

import { IllustrationSetting } from "../IllustrationSetting";

/** The illustrations of the login and home pages. */
export function PageIllustrationSettings() {
  return (
    <>
      <IllustrationSetting
        name="login-page-illustration"
        title={t`Login page`}
        description={t`Shown behind the login form and on the unsubscribe page.`}
        defaultSrc={bridgeImage}
      />
      <IllustrationSetting
        name="landing-page-illustration"
        title={t`Home page`}
        description={t`Shown at the bottom of the home page.`}
        defaultSrc={bridgeImage}
      />
    </>
  );
}

/** The illustrations shown when there is nothing to show. */
export function EmptyStateIllustrationSettings() {
  return (
    <>
      <IllustrationSetting
        name="no-data-illustration"
        title={t`No results`}
        description={t`Shown when a question or a dashboard card returns no results.`}
        defaultSrc={noResultsSource}
      />
      <IllustrationSetting
        name="no-object-illustration"
        title={t`Nothing found`}
        description={t`Shown when a search or a list has nothing to show.`}
        defaultSrc={noResultsSource}
      />
    </>
  );
}
