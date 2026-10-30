import { useCallback } from "react";
import { t } from "ttag";

import { StrategyForm } from "metabase/admin/performance/components/StrategyForm";
import { useConfirmIfFormIsDirty } from "metabase/admin/performance/hooks/useConfirmIfFormIsDirty";
import { useSaveStrategy } from "metabase/admin/performance/hooks/useSaveStrategy";
import { DelayedLoadingAndErrorWrapper } from "metabase/common/components/LoadingAndErrorWrapper/DelayedLoadingAndErrorWrapper";
import { SidesheetSubPage } from "metabase/common/components/Sidesheet";
import type { ModalOverlayProps } from "metabase/ui";
import type { CacheStrategy, CacheableModel } from "metabase-types/api";

import { useTargetCacheConfig } from "../../hooks/useTargetCacheConfig";

export type CacheStrategySidesheetProps = {
  targetId: number;
  targetModel: CacheableModel;
  targetName: string;
  isOpen: boolean;
  /** Closes the sidesheet and whatever it was opened from */
  onClose: () => void;
  /** Goes back to where the sidesheet was opened from. Also called once the policy is saved. */
  onBack: () => void;
  withBackButton?: boolean;
  withOverlay?: boolean;
  overlayProps?: ModalOverlayProps;
};

/**
 * A sidesheet for editing the caching policy of a dashboard or question.
 * Closing it with unsaved changes asks for confirmation first.
 */
export const CacheStrategySidesheet = ({
  targetId,
  targetModel,
  targetName,
  isOpen,
  onClose,
  onBack,
  withBackButton = true,
  withOverlay = true,
  overlayProps,
}: CacheStrategySidesheetProps) => {
  const { savedStrategy, error, isLoading } = useTargetCacheConfig(
    targetId,
    targetModel,
  );
  const saveStrategy = useSaveStrategy(targetId, targetModel);
  const {
    askBeforeDiscardingChanges,
    confirmationModal,
    isStrategyFormDirty,
    setIsStrategyFormDirty,
  } = useConfirmIfFormIsDirty();

  const confirmIfDirty = useCallback(
    (action: () => void) => {
      if (isStrategyFormDirty) {
        askBeforeDiscardingChanges(action);
      } else {
        action();
      }
    },
    [isStrategyFormDirty, askBeforeDiscardingChanges],
  );

  const handleSave = useCallback(
    async (values: CacheStrategy) => {
      await saveStrategy(values);
      setIsStrategyFormDirty(false);
      onBack();
    },
    [saveStrategy, setIsStrategyFormDirty, onBack],
  );

  const handleBack = () => confirmIfDirty(onBack);

  return (
    <SidesheetSubPage
      title={t`Caching settings`}
      isOpen={isOpen}
      onClose={() => confirmIfDirty(onClose)}
      onBack={handleBack}
      withBackButton={withBackButton}
      withOverlay={withOverlay}
      overlayProps={overlayProps}
    >
      <DelayedLoadingAndErrorWrapper loading={isLoading} error={error}>
        <StrategyForm
          targetId={targetId}
          targetModel={targetModel}
          targetName={targetName}
          setIsDirty={setIsStrategyFormDirty}
          saveStrategy={handleSave}
          savedStrategy={savedStrategy}
          shouldAllowInvalidation={savedStrategy?.type !== "nocache"}
          shouldShowName={false}
          layout="sidebar"
          onCancel={handleBack}
        />
      </DelayedLoadingAndErrorWrapper>
      {confirmationModal}
    </SidesheetSubPage>
  );
};
