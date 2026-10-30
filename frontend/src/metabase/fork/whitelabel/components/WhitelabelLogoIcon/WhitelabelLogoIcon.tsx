import type { ComponentProps } from "react";
import { t } from "ttag";

import { DefaultLogoIcon } from "metabase/common/components/LogoIcon";
import { useSelector } from "metabase/redux";
import { useSetting } from "metabase/settings";
import { Image } from "metabase/ui";

import { DEFAULT_LOGO_URL } from "../../constants";
import { getApplicationName } from "../../selectors";

type WhitelabelLogoIconProps = ComponentProps<typeof DefaultLogoIcon>;

const DEFAULT_HEIGHT = 32;

/**
 * The application logo: the uploaded `application-logo-url` image, or the
 * default logo when none is set.
 */
export function WhitelabelLogoIcon(props: WhitelabelLogoIconProps) {
  const logoUrl = useSetting("application-logo-url");
  const applicationName = useSelector(getApplicationName);

  if (!logoUrl || logoUrl === DEFAULT_LOGO_URL) {
    return <DefaultLogoIcon {...props} themed />;
  }

  return (
    <Image
      src={logoUrl}
      alt={t`${applicationName} logo`}
      h={props.height ?? DEFAULT_HEIGHT}
      w={props.width ?? "auto"}
      maw="100%"
      fit="contain"
      data-testid="main-logo"
    />
  );
}
