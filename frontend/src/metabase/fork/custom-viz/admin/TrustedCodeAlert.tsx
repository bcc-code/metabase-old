import { t } from "ttag";

import { Alert, Icon } from "metabase/ui";

export function TrustedCodeAlert() {
  return (
    <Alert
      color="warning"
      icon={<Icon name="warning" />}
      title={t`Only install visualizations you trust`}
    >
      {t`A custom visualization is JavaScript that runs in the browser of everyone who views it, with the same access they have. Only install bundles from people you trust.`}
    </Alert>
  );
}
