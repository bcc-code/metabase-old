import { useCallback } from "react";
import { t } from "ttag";

import { StrategyForm } from "metabase/admin/performance/components/StrategyForm";
import { useConfirmIfFormIsDirty } from "metabase/admin/performance/hooks/useConfirmIfFormIsDirty";
import { useSaveStrategy } from "metabase/admin/performance/hooks/useSaveStrategy";
import { DelayedLoadingAndErrorWrapper } from "metabase/common/components/LoadingAndErrorWrapper/DelayedLoadingAndErrorWrapper";
import type { MetricCachingModalProps } from "metabase/plugins";
import { Modal } from "metabase/ui";
import type { CacheStrategy } from "metabase-types/api";

import { useTargetCacheConfig } from "../../hooks/useTargetCacheConfig";

/** The caching settings of a metric. Closing it with unsaved changes asks for confirmation first. */
export const MetricCachingModal = ({
  cardId,
  cardName,
  onClose,
}: MetricCachingModalProps) => {
  const { savedStrategy, error, isLoading } = useTargetCacheConfig(
    cardId,
    "metric",
  );
  const saveStrategy = useSaveStrategy(cardId, "metric");
  const {
    askBeforeDiscardingChanges,
    confirmationModal,
    isStrategyFormDirty,
    setIsStrategyFormDirty,
  } = useConfirmIfFormIsDirty();

  const handleClose = () => {
    if (isStrategyFormDirty) {
      askBeforeDiscardingChanges(onClose);
    } else {
      onClose();
    }
  };

  const handleSave = useCallback(
    async (values: CacheStrategy) => {
      await saveStrategy(values);
      setIsStrategyFormDirty(false);
      onClose();
    },
    [saveStrategy, setIsStrategyFormDirty, onClose],
  );

  return (
    <Modal opened onClose={handleClose} title={t`Caching settings`} size="lg">
      <DelayedLoadingAndErrorWrapper loading={isLoading} error={error}>
        <StrategyForm
          targetId={cardId}
          targetModel="metric"
          targetName={cardName}
          setIsDirty={setIsStrategyFormDirty}
          saveStrategy={handleSave}
          savedStrategy={savedStrategy}
          shouldAllowInvalidation={savedStrategy?.type !== "nocache"}
          shouldShowName={false}
          layout="modal"
          onCancel={handleClose}
        />
      </DelayedLoadingAndErrorWrapper>
      {confirmationModal}
    </Modal>
  );
};
