import { useState } from "react";
import { match } from "ts-pattern";
import { t } from "ttag";

import { useInvalidateTarget } from "metabase/admin/performance/hooks/useInvalidateTarget";
import { ConfirmModal } from "metabase/common/components/ConfirmModal";
import { Button, Icon } from "metabase/ui";
import type { CacheableModel } from "metabase-types/api";

type ClearStatus = "idle" | "clearing" | "cleared";

export type ClearCacheButtonProps = {
  targetId: number;
  targetModel: CacheableModel;
  targetName: string;
};

const getButtonLabel = (model: CacheableModel) =>
  match(model)
    .with("root", () => t`Clear all cached results`)
    .with("database", () => t`Clear cache for this database`)
    .with("dashboard", () => t`Clear cache for this dashboard`)
    .with("question", () => t`Clear cache for this question`)
    .with("metric", () => t`Clear cache for this metric`)
    .exhaustive();

const getConfirmationTitle = (model: CacheableModel, name: string) =>
  model === "root"
    ? t`Clear all cached results?`
    : t`Clear the cache for ${name}?`;

const getConfirmationMessage = (model: CacheableModel) =>
  match(model)
    .with(
      "root",
      () =>
        t`Every question will get fresh results the next time it runs, whatever its database, dashboard or policy.`,
    )
    .with(
      "database",
      () =>
        t`Every question that uses this database will get fresh results the next time it runs.`,
    )
    .with(
      "dashboard",
      () =>
        t`Every question on this dashboard will get fresh results the next time it runs.`,
    )
    .with(
      "question",
      () => t`This question will get fresh results the next time it runs.`,
    )
    .with(
      "metric",
      () => t`This metric will get fresh results the next time it runs.`,
    )
    .exhaustive();

/**
 * Clears the cached results of a database, dashboard or question (everything
 * cached under it), or with the root model every cached result, after the
 * person confirms.
 */
export const ClearCacheButton = ({
  targetId,
  targetModel,
  targetName,
}: ClearCacheButtonProps) => {
  const [status, setStatus] = useState<ClearStatus>("idle");
  const [isConfirming, setIsConfirming] = useState(false);
  // Shows a toast with the error when clearing fails
  const invalidateTarget = useInvalidateTarget(targetId, targetModel);

  const handleConfirm = async () => {
    setIsConfirming(false);
    setStatus("clearing");
    try {
      await invalidateTarget();
      setStatus("cleared");
    } catch {
      setStatus("idle");
    }
  };

  return (
    <>
      <Button
        variant="subtle"
        px={0}
        leftSection={
          <Icon name={status === "cleared" ? "check" : "trash"} aria-hidden />
        }
        loading={status === "clearing"}
        onClick={() => setIsConfirming(true)}
      >
        {status === "cleared" ? t`Cache cleared` : getButtonLabel(targetModel)}
      </Button>
      <ConfirmModal
        opened={isConfirming}
        title={getConfirmationTitle(targetModel, targetName)}
        message={getConfirmationMessage(targetModel)}
        confirmButtonText={t`Clear cache`}
        onConfirm={handleConfirm}
        onClose={() => setIsConfirming(false)}
        data-testid="confirm-modal"
      />
    </>
  );
};
