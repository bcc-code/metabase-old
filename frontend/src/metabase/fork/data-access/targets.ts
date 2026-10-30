import type { Card, Field, ParameterTarget } from "metabase-types/api";

/** Something a user attribute can be remapped onto: a column, or a variable of a native question. */
export interface TargetOption {
  key: string;
  label: string;
  target: ParameterTarget;
}

export const getTargetKey = (target: ParameterTarget): string =>
  JSON.stringify(target);

const toOption = (target: ParameterTarget, label: string): TargetOption => ({
  key: getTargetKey(target),
  label,
  target,
});

const isTemplateTagTarget = (target: ParameterTarget): boolean => {
  const reference = target[1];
  return Array.isArray(reference) && reference[0] === "template-tag";
};

const getColumnTarget = (column: Field): ParameterTarget =>
  typeof column.id === "number"
    ? ["dimension", ["field", column.id, null]]
    : ["dimension", ["field", column.name, { "base-type": column.base_type }]];

/** The columns of the table, for a policy that filters the table itself. */
export function getTableTargetOptions(fields: Field[]): TargetOption[] {
  return fields.map((field) =>
    toOption(getColumnTarget(field), field.display_name),
  );
}

/** The variables of a native question, then its columns. */
export function getQuestionTargetOptions(card: Card): TargetOption[] {
  const variables = (card.parameters ?? []).flatMap((parameter) =>
    parameter.target != null && isTemplateTagTarget(parameter.target)
      ? [toOption(parameter.target, parameter.name)]
      : [],
  );
  const columns = (card.result_metadata ?? []).map((column) =>
    toOption(getColumnTarget(column), column.display_name),
  );
  return [...variables, ...columns];
}
