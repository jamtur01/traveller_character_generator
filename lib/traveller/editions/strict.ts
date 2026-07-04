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
