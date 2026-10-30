import { msgid, ngettext } from "ttag";

import {
  isBoolean,
  isDate,
  isNumeric,
  isString,
} from "metabase-lib/v1/types/utils/isa";
import type { DatasetColumn, DatasetData } from "metabase-types/api";

import {
  CUSTOM_VIZ_REQUIRED_COLUMN_TYPES,
  type CustomVizColumn,
  type CustomVizDataRequirements,
  type CustomVizRequiredColumnType,
} from "../types";

const COLUMN_TYPE_PREDICATES: Record<
  CustomVizRequiredColumnType,
  (column: DatasetColumn) => boolean
> = {
  number: isNumeric,
  string: isString,
  date: isDate,
  boolean: isBoolean,
};

const MISSING_COLUMNS_MESSAGES: Record<
  CustomVizRequiredColumnType,
  (count: number) => string
> = {
  number: (count) =>
    ngettext(
      msgid`This visualization needs at least ${count} number column.`,
      `This visualization needs at least ${count} number columns.`,
      count,
    ),
  string: (count) =>
    ngettext(
      msgid`This visualization needs at least ${count} text column.`,
      `This visualization needs at least ${count} text columns.`,
      count,
    ),
  date: (count) =>
    ngettext(
      msgid`This visualization needs at least ${count} date column.`,
      `This visualization needs at least ${count} date columns.`,
      count,
    ),
  boolean: (count) =>
    ngettext(
      msgid`This visualization needs at least ${count} true/false column.`,
      `This visualization needs at least ${count} true/false columns.`,
      count,
    ),
};

/** The kind of a query result column, in the plugin contract's vocabulary. */
export function getCustomVizColumnType(
  column: DatasetColumn,
): CustomVizColumn["type"] {
  return (
    CUSTOM_VIZ_REQUIRED_COLUMN_TYPES.find((columnType) =>
      COLUMN_TYPE_PREDICATES[columnType](column),
    ) ?? "other"
  );
}

/**
 * Why a plugin with `requirements` can't render `data`, or `null` when it can.
 */
export function getDataRequirementsProblem(
  requirements: CustomVizDataRequirements | undefined,
  { rows, cols }: Pick<DatasetData, "rows" | "cols">,
): string | null {
  const {
    minRows,
    maxRows,
    minColumns,
    maxColumns,
    requiredColumnTypes = {},
  } = requirements ?? {};

  if (minRows != null && rows.length < minRows) {
    return ngettext(
      msgid`This visualization needs at least ${minRows} row of data.`,
      `This visualization needs at least ${minRows} rows of data.`,
      minRows,
    );
  }
  if (maxRows != null && rows.length > maxRows) {
    return ngettext(
      msgid`This visualization can show at most ${maxRows} row of data.`,
      `This visualization can show at most ${maxRows} rows of data.`,
      maxRows,
    );
  }
  if (minColumns != null && cols.length < minColumns) {
    return ngettext(
      msgid`This visualization needs at least ${minColumns} column.`,
      `This visualization needs at least ${minColumns} columns.`,
      minColumns,
    );
  }
  if (maxColumns != null && cols.length > maxColumns) {
    return ngettext(
      msgid`This visualization can show at most ${maxColumns} column.`,
      `This visualization can show at most ${maxColumns} columns.`,
      maxColumns,
    );
  }

  const missingColumnType = CUSTOM_VIZ_REQUIRED_COLUMN_TYPES.find(
    (columnType) => {
      const count = requiredColumnTypes[columnType] ?? 0;
      return cols.filter(COLUMN_TYPE_PREDICATES[columnType]).length < count;
    },
  );
  return missingColumnType
    ? MISSING_COLUMNS_MESSAGES[missingColumnType](
        requiredColumnTypes[missingColumnType] ?? 0,
      )
    : null;
}
