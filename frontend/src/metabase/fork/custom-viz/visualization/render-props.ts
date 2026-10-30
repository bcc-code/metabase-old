import { isValidIconName } from "metabase/ui";
import { formatValue } from "metabase/visualizations/custom-visualizations/custom-viz-utils";
import type { ClickObject } from "metabase/visualizations/types";
import {
  type ComputedVisualizationSettings,
  getTableCellClickedObject,
  getTableClickedObjectRowData,
} from "metabase/viz-core";
import type { DatasetColumn, IconName, Series } from "metabase-types/api";
import { isObject } from "metabase-types/guards";

import type { CustomVizClickEvent, CustomVizColumn } from "../types";

import { getCustomVizColumnType } from "./data-requirements";

export const DEFAULT_CUSTOM_VIZ_ICON: IconName = "lineandbar";

/** The Metabase icon a plugin asked for, or a generic chart icon. */
export function getCustomVizIconName(
  icon: string | null | undefined,
): IconName {
  return isValidIconName(icon) ? icon : DEFAULT_CUSTOM_VIZ_ICON;
}

export function toCustomVizColumn(column: DatasetColumn): CustomVizColumn {
  return {
    name: column.name,
    displayName: column.display_name,
    type: getCustomVizColumnType(column),
    baseType: column.base_type ?? "type/*",
    semanticType: column.semantic_type ?? null,
  };
}

/**
 * `value` formatted the way Metabase formats the column named `columnName`,
 * including the column's formatting settings.
 */
export function formatColumnValue(
  value: unknown,
  columnName: unknown,
  columns: DatasetColumn[],
  settings: ComputedVisualizationSettings,
): string {
  const column = columns.find(({ name }) => name === columnName);
  if (!column) {
    return String(value ?? "");
  }
  return formatValue(value, settings.column?.(column) ?? { column });
}

function parseClickEvent(value: unknown): CustomVizClickEvent | null {
  if (!isObject(value)) {
    return null;
  }
  const { rowIndex, columnName, event, element } = value;
  if (typeof rowIndex !== "number" || !Number.isInteger(rowIndex)) {
    return null;
  }
  if (typeof columnName !== "string") {
    return null;
  }
  return {
    rowIndex,
    columnName,
    event: event instanceof MouseEvent ? event : undefined,
    element: element instanceof Element ? element : undefined,
  };
}

/**
 * The click object for a plugin's click on the cell at `rowIndex` in the
 * column named `columnName`, built like a table cell click so drill-through
 * works, or `null` when `value` doesn't name a cell.
 */
export function getCustomVizClickObject(
  series: Series,
  settings: ComputedVisualizationSettings,
  value: unknown,
): ClickObject | null {
  const click = parseClickEvent(value);
  const [{ data }] = series;
  const columnIndex = data.cols.findIndex(
    (column) => column.name === click?.columnName,
  );
  if (!click || columnIndex < 0 || !data.rows[click.rowIndex]) {
    return null;
  }

  return {
    ...getTableCellClickedObject(
      data,
      settings,
      click.rowIndex,
      columnIndex,
      false,
      getTableClickedObjectRowData(
        series,
        click.rowIndex,
        columnIndex,
        false,
        data,
      ),
    ),
    event: click.event,
    element: click.element,
  };
}
