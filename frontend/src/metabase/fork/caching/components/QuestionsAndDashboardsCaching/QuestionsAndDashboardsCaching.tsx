import { useEffect, useState } from "react";
import { match } from "ts-pattern";
import { t } from "ttag";

import { PerformancePageContent } from "metabase/admin/performance/components/PerformancePageContent";
import {
  getShortStrategyLabel,
  translateConfigFromAPI,
} from "metabase/admin/performance/utils";
import {
  useDeleteCacheConfigsMutation,
  useListCacheConfigsQuery,
} from "metabase/api";
import { findErrorMessage } from "metabase/api/utils/errors";
import { Link } from "metabase/common/components/Link";
import { DelayedLoadingAndErrorWrapper } from "metabase/common/components/LoadingAndErrorWrapper/DelayedLoadingAndErrorWrapper";
import { Table } from "metabase/common/components/Table";
import { useConfirmation } from "metabase/common/hooks/use-confirmation";
import { useDispatch } from "metabase/redux";
import { addUndo } from "metabase/redux/undo";
import { SettingsPageWrapper } from "metabase/settings-components";
import {
  ActionIcon,
  Button,
  FixedSizeIcon,
  Group,
  Icon,
  Menu,
  Stack,
  Text,
} from "metabase/ui";
import * as Urls from "metabase/urls";
import type {
  CacheSortColumn,
  CacheStrategy,
  SortDirection,
} from "metabase-types/api";

import { CacheStrategySidesheet } from "../CacheStrategySidesheet/CacheStrategySidesheet";

const PAGE_SIZE = 25;

type CachedItemModel = "dashboard" | "question";

type CachedItemRow = {
  id: string;
  model: CachedItemModel;
  modelId: number;
  name: string;
  collectionName: string | null;
  strategy: CacheStrategy;
};

type CachedItem = Pick<CachedItemRow, "model" | "modelId" | "name">;

const toCachedItemModel = (model: string): CachedItemModel | null =>
  match(model)
    .with("dashboard", "question", (cachedItemModel) => cachedItemModel)
    .otherwise(() => null);

const toCacheSortColumn = (column: string): CacheSortColumn | null =>
  match(column)
    .with("name", "collection", "policy", (sortColumn) => sortColumn)
    .otherwise(() => null);

const getItemUrl = ({ model, modelId, name }: CachedItem) =>
  model === "dashboard"
    ? Urls.dashboard({ id: modelId, name })
    : Urls.card({ id: modelId, name });

/** Admin > Performance > Dashboard and question caching */
export const StrategyEditorForQuestionsAndDashboards = () => (
  <PerformancePageContent>
    <SettingsPageWrapper
      title={t`Dashboard and question caching`}
      description={t`Dashboards and questions with a caching policy of their own, instead of their database’s or the default one. You can give a dashboard or question its own policy in its settings.`}
    >
      <DashboardAndQuestionCachingTab />
    </SettingsPageWrapper>
  </PerformancePageContent>
);

/** The dashboards and questions that have their own caching policy, which can be edited or reset from here. */
export const DashboardAndQuestionCachingTab = () => {
  const [page, setPage] = useState(0);
  const [sortColumn, setSortColumn] = useState<CacheSortColumn>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [editedItem, setEditedItem] = useState<CachedItem | null>(null);

  const { data, error, isLoading } = useListCacheConfigsQuery({
    model: ["dashboard", "question"],
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    sort_column: sortColumn,
    sort_direction: sortDirection,
  });

  const rows: CachedItemRow[] = (data?.data ?? []).flatMap((apiConfig) => {
    const config = translateConfigFromAPI(apiConfig);
    const model = toCachedItemModel(config.model);
    return model
      ? [
          {
            id: `${model}-${config.model_id}`,
            model,
            modelId: config.model_id,
            name: config.name ?? "",
            collectionName: config.collection?.name ?? null,
            strategy: config.strategy,
          },
        ]
      : [];
  });

  const isPageEmpty = !isLoading && page > 0 && rows.length === 0;
  useEffect(() => {
    // the last item of the last page was reset to the default policy
    if (isPageEmpty) {
      setPage((page) => page - 1);
    }
  }, [isPageEmpty]);

  if (error || isLoading) {
    return <DelayedLoadingAndErrorWrapper error={error} loading={isLoading} />;
  }

  const handleSort = (column: string, direction: SortDirection) => {
    const nextSortColumn = toCacheSortColumn(column);
    if (nextSortColumn) {
      setSortColumn(nextSortColumn);
      setSortDirection(direction);
      setPage(0);
    }
  };

  return (
    <>
      <Table<CachedItemRow>
        data-testid="cache-config-table"
        aria-label={t`Dashboards and questions with their own caching policy`}
        columns={[
          { name: t`Name`, key: "name" },
          { name: t`Collection`, key: "collection" },
          { name: t`Policy`, key: "policy" },
          { name: "", key: "actions", sortable: false },
        ]}
        rows={rows}
        sortColumnName={sortColumn}
        sortDirection={sortDirection}
        onSort={handleSort}
        paginationProps={{
          page,
          pageSize: PAGE_SIZE,
          total: data?.total ?? rows.length,
          showTotal: true,
          onPageChange: setPage,
        }}
        rowRenderer={(row) => (
          <CachedItemTableRow row={row} onEdit={() => setEditedItem(row)} />
        )}
        emptyBody={
          <Stack align="center" gap="sm" py="xl">
            <Text fw="bold">{t`No dashboards or questions have their own caching policy yet`}</Text>
            <Text c="text-secondary">
              {t`They all use their database’s policy, or the default one.`}
            </Text>
          </Stack>
        }
      />
      {editedItem && (
        <CacheStrategySidesheet
          targetId={editedItem.modelId}
          targetModel={editedItem.model}
          targetName={editedItem.name}
          isOpen
          withBackButton={false}
          onClose={() => setEditedItem(null)}
          onBack={() => setEditedItem(null)}
        />
      )}
    </>
  );
};

const CachedItemTableRow = ({
  row,
  onEdit,
}: {
  row: CachedItemRow;
  onEdit: () => void;
}) => {
  const policyLabel = getShortStrategyLabel(row.strategy, row.model) ?? "";
  return (
    <tr>
      <td>
        <Link to={getItemUrl(row)} variant="brand">
          <Group gap="sm" wrap="nowrap">
            <FixedSizeIcon
              name={row.model === "dashboard" ? "dashboard" : "table2"}
            />
            {row.name}
          </Group>
        </Link>
      </td>
      <td>{row.collectionName ?? t`Our analytics`}</td>
      <td>
        <Button
          variant="subtle"
          px={0}
          aria-label={t`Edit the policy of ${row.name}, currently ${policyLabel}`}
          onClick={onEdit}
        >
          {policyLabel}
        </Button>
      </td>
      <td>
        <CachedItemMenu row={row} />
      </td>
    </tr>
  );
};

const CachedItemMenu = ({ row }: { row: CachedItemRow }) => {
  const dispatch = useDispatch();
  const [deleteCacheConfigs] = useDeleteCacheConfigsMutation();
  const { show: askConfirmation, modalContent } = useConfirmation();

  const resetToDefault = async () => {
    try {
      await deleteCacheConfigs({
        model: row.model,
        model_id: row.modelId,
      }).unwrap();
    } catch (error) {
      dispatch(
        addUndo({
          variant: "negative",
          message: findErrorMessage(error) ?? t`The policy could not be reset.`,
        }),
      );
    }
  };

  return (
    <>
      <Menu position="bottom-end">
        <Menu.Target>
          <ActionIcon aria-label={t`More options for ${row.name}`}>
            <Icon name="ellipsis" />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            leftSection={<Icon name="revert" />}
            onClick={() =>
              askConfirmation({
                title: t`Reset ${row.name} to the default policy?`,
                message:
                  row.model === "dashboard"
                    ? t`Its questions will use their own policy, or their database’s, or the default one.`
                    : t`It will use the policy of the dashboard it runs on, or its database’s, or the default one.`,
                confirmButtonText: t`Reset`,
                onConfirm: resetToDefault,
              })
            }
          >
            {t`Reset to default`}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      {modalContent}
    </>
  );
};
