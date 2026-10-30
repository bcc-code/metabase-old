/** A positive integer route param, or null when it's missing or malformed. */
export function parseRouteId(value: string | undefined): number | null {
  if (value == null || !/^\d+$/.test(value)) {
    return null;
  }
  const id = Number(value);
  return id > 0 ? id : null;
}
