// Strict edition-JSON reads. Project law (AGENTS.md): every game value
// lives in data/editions/<id>.json with a $rule citation — code never
// shadows a JSON value with a `?? default`. When a required value is
// absent the edition data is broken; fail loudly with the citation so
// the fix lands in the JSON, not in a code fallback.

/** Return `value` unless it is undefined/null, in which case throw a
 *  citation-bearing error naming the missing JSON field. `what` names
 *  the JSON path (e.g. "rules.survival.fullTermYears"); `rule` cites
 *  the printed rule (e.g. "TTB p. 18 / PM p. 15"). */
export function requireRule<T>(
  value: T | undefined | null, what: string, rule: string,
): T {
  if (value === undefined || value === null) {
    throw new Error(
      `Edition JSON is missing ${what} (${rule}). Game values must be ` +
      `declared in data/editions/<id>.json, never defaulted in code.`,
    );
  }
  return value;
}

/** Parse a JSON die spec ("1D", "2D") to its die count. Unknown formats are
 *  broken edition data and fail loudly — a silent default would quietly
 *  change how many dice a declared throw rolls. */
export function parseDieCount(spec: string, what: string): number {
  const m = /^(\d+)D$/i.exec(spec.trim());
  if (!m) {
    throw new Error(
      `${what}: unrecognized die spec "${spec}" — expected "<n>D" (e.g. "1D", "2D").`,
    );
  }
  return parseInt(m[1]!, 10);
}
