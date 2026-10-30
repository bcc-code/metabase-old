import { useState } from "react";
import { c, t } from "ttag";

import { PerformancePageContent } from "metabase/admin/performance/components/PerformancePageContent";
import { StrategyForm } from "metabase/admin/performance/components/StrategyForm";
import {
  defaultRootStrategy,
  rootId,
} from "metabase/admin/performance/constants/simple";
import { useCacheConfigs } from "metabase/admin/performance/hooks/useCacheConfigs";
import { useConfirmIfFormIsDirty } from "metabase/admin/performance/hooks/useConfirmIfFormIsDirty";
import { useSaveStrategy } from "metabase/admin/performance/hooks/useSaveStrategy";
import { getShortStrategyLabel } from "metabase/admin/performance/utils";
import {
  useDeleteCacheConfigsMutation,
  useListDatabasesQuery,
} from "metabase/api";
import { findErrorMessage } from "metabase/api/utils/errors";
import { DelayedLoadingAndErrorWrapper } from "metabase/common/components/LoadingAndErrorWrapper/DelayedLoadingAndErrorWrapper";
import { useConfirmation } from "metabase/common/hooks/use-confirmation";
import { useDispatch } from "metabase/redux";
import { addUndo } from "metabase/redux/undo";
import { SettingsPageWrapper } from "metabase/settings-components";
import {
  Box,
  Button,
  Ellipsified,
  FixedSizeIcon,
  Flex,
  Group,
  Stack,
  Text,
  UnstyledButton,
} from "metabase/ui";
import type { CacheConfig, CacheStrategy, IconName } from "metabase-types/api";

import { ClearCacheButton } from "../ClearCacheButton/ClearCacheButton";

import S from "./DatabaseCachingEditor.module.css";

type CachingTarget = { model: "root" | "database"; id: number };

const ROOT_TARGET: CachingTarget = { model: "root", id: rootId };

const findStrategy = (
  configs: CacheConfig[],
  { model, id }: CachingTarget,
): CacheStrategy | undefined =>
  configs.find((config) => config.model === model && config.model_id === id)
    ?.strategy;

/**
 * Admin > Performance > Database caching: the default (instance-wide) caching
 * policy, and a policy of its own for each database.
 */
export const DatabaseCachingEditor = () => {
  const {
    data: databasesResponse,
    error: databasesError,
    isLoading: areDatabasesLoading,
  } = useListDatabasesQuery();
  const {
    configs,
    error: configsError,
    isLoading: areConfigsLoading,
  } = useCacheConfigs({ model: ["root", "database"] });

  const [target, setTarget] = useState<CachingTarget>(ROOT_TARGET);
  const saveStrategy = useSaveStrategy(target.id, target.model);
  const {
    askBeforeDiscardingChanges,
    confirmationModal,
    isStrategyFormDirty,
    setIsStrategyFormDirty,
  } = useConfirmIfFormIsDirty();

  const error = databasesError ?? configsError;
  if (error || areDatabasesLoading || areConfigsLoading || !configs) {
    return (
      <DelayedLoadingAndErrorWrapper
        error={error}
        loading={areDatabasesLoading || areConfigsLoading}
      />
    );
  }

  const databases = (databasesResponse?.data ?? []).filter(
    (database) => !database.is_audit,
  );
  const rootStrategy =
    findStrategy(configs, ROOT_TARGET) ?? defaultRootStrategy;
  const isRootTarget = target.model === "root";
  const savedStrategy = findStrategy(configs, target);
  const effectiveStrategy = savedStrategy ?? rootStrategy;
  const targetName = isRootTarget
    ? t`Default policy`
    : (databases.find((database) => database.id === target.id)?.name ?? "");

  const selectTarget = (nextTarget: CachingTarget) => {
    const isSameTarget =
      nextTarget.model === target.model && nextTarget.id === target.id;
    if (isSameTarget) {
      return;
    }
    if (isStrategyFormDirty) {
      askBeforeDiscardingChanges(() => setTarget(nextTarget));
    } else {
      setTarget(nextTarget);
    }
  };

  const databaseIdsWithOwnPolicy = databases
    .filter((database) =>
      findStrategy(configs, { model: "database", id: database.id }),
    )
    .map((database) => database.id);

  return (
    <PerformancePageContent>
      <SettingsPageWrapper
        title={t`Database caching`}
        aria-label={t`Data caching settings`}
        description={t`Speed up queries by caching their results. Each database uses the default policy, unless you give it a policy of its own. Dashboards and questions can override these in their settings.`}
        h="calc(100vh - 9rem)"
      >
        {confirmationModal}
        <Flex gap="xl" className={S.layout}>
          <Stack
            className={S.panel}
            w="22rem"
            miw="16rem"
            gap={0}
            component="section"
            aria-label={t`Caching policies`}
          >
            <Stack className={S.scrollable} gap="xs" p="sm">
              <CachingTargetRow
                name={t`Default policy`}
                icon="gear"
                strategy={rootStrategy}
                isSelected={isRootTarget}
                onSelect={() => selectTarget(ROOT_TARGET)}
              />
              {databases.map((database) => {
                const databaseTarget: CachingTarget = {
                  model: "database",
                  id: database.id,
                };
                const ownStrategy = findStrategy(configs, databaseTarget);
                return (
                  <CachingTargetRow
                    key={database.id}
                    name={database.name}
                    icon="database"
                    strategy={ownStrategy ?? rootStrategy}
                    isInherited={!ownStrategy}
                    isSelected={
                      target.model === "database" && target.id === database.id
                    }
                    onSelect={() => selectTarget(databaseTarget)}
                  />
                );
              })}
            </Stack>
            {databaseIdsWithOwnPolicy.length > 0 && (
              <ResetAllToDefaultButton databaseIds={databaseIdsWithOwnPolicy} />
            )}
          </Stack>
          <Flex
            className={S.panel}
            direction="column"
            flex={1}
            maw="40rem"
            component="section"
          >
            <Box className={S.scrollable} key={`${target.model}-${target.id}`}>
              <StrategyForm
                targetId={target.id}
                targetModel={target.model}
                targetName={targetName}
                setIsDirty={setIsStrategyFormDirty}
                saveStrategy={saveStrategy}
                savedStrategy={savedStrategy}
                shouldAllowInvalidation={effectiveStrategy.type !== "nocache"}
              />
            </Box>
            {isRootTarget && !isStrategyFormDirty && (
              <Box className={S.footer} px="2.5rem" py="lg">
                <ClearCacheButton
                  targetId={rootId}
                  targetModel="root"
                  targetName={targetName}
                />
              </Box>
            )}
          </Flex>
        </Flex>
      </SettingsPageWrapper>
    </PerformancePageContent>
  );
};

type CachingTargetRowProps = {
  name: string;
  icon: IconName;
  strategy: CacheStrategy;
  /** Whether the strategy is the default policy, rather than the target's own */
  isInherited?: boolean;
  isSelected: boolean;
  onSelect: () => void;
};

const CachingTargetRow = ({
  name,
  icon,
  strategy,
  isInherited = false,
  isSelected,
  onSelect,
}: CachingTargetRowProps) => {
  const policyLabel = getShortStrategyLabel(strategy) ?? "";
  return (
    <UnstyledButton
      className={S.targetRow}
      aria-pressed={isSelected}
      aria-label={t`Edit ${name}, currently ${policyLabel}`}
      onClick={onSelect}
    >
      <Group justify="space-between" wrap="nowrap" gap="md">
        <Group gap="sm" wrap="nowrap" miw={0}>
          <FixedSizeIcon name={icon} c="text-secondary" />
          <Ellipsified fw="bold">{name}</Ellipsified>
        </Group>
        <Text
          c={isInherited ? "text-secondary" : "text-primary"}
          style={{ flexShrink: 0 }}
        >
          {isInherited
            ? c(
                "{0} is the short name of the default caching policy, like 'Adaptive'",
              ).t`Default: ${policyLabel}`
            : policyLabel}
        </Text>
      </Group>
    </UnstyledButton>
  );
};

const ResetAllToDefaultButton = ({
  databaseIds,
}: {
  databaseIds: number[];
}) => {
  const dispatch = useDispatch();
  const [deleteCacheConfigs, { isLoading }] = useDeleteCacheConfigsMutation();
  const { show: askConfirmation, modalContent } = useConfirmation();

  const resetAll = async () => {
    try {
      await deleteCacheConfigs({
        model: "database",
        model_id: databaseIds,
      }).unwrap();
    } catch (error) {
      dispatch(
        addUndo({
          variant: "negative",
          message:
            findErrorMessage(error) ?? t`The policies could not be reset.`,
        }),
      );
    }
  };

  return (
    <Box className={S.footer} p="md">
      <Button
        variant="subtle"
        px={0}
        loading={isLoading}
        onClick={() =>
          askConfirmation({
            title: t`Reset all databases to the default policy?`,
            message: t`Every database will use the default policy. Dashboards and questions keep their own policies.`,
            confirmButtonText: t`Reset`,
            onConfirm: resetAll,
          })
        }
      >
        {t`Reset all to default`}
      </Button>
      {modalContent}
    </Box>
  );
};
