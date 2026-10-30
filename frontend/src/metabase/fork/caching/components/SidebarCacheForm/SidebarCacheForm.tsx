import type { SidebarCacheFormProps } from "metabase/plugins";

import { getCacheTarget } from "../../utils";
import { CacheStrategySidesheet } from "../CacheStrategySidesheet/CacheStrategySidesheet";

/** The caching settings of a dashboard or question, as a sub-page of its settings sidesheet */
export const SidebarCacheForm = ({
  item,
  model,
  isOpen,
  onClose,
  onBack,
  withBackButton,
  withOverlay,
  overlayProps,
}: SidebarCacheFormProps) => {
  const { id, name } = getCacheTarget(item);
  return (
    <CacheStrategySidesheet
      targetId={id}
      targetModel={model}
      targetName={name}
      isOpen={isOpen}
      onClose={onClose}
      onBack={onBack}
      withBackButton={withBackButton}
      withOverlay={withOverlay}
      overlayProps={overlayProps}
    />
  );
};
