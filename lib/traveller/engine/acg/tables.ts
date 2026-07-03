// Helpers for reading the assignment / resolution / branch tables that
// every ACG pathway declares in JSON. The shapes vary slightly per
// pathway, so these helpers normalize the lookups.

import type { Character } from "@/lib/traveller/character";
import { getEdition } from "@/lib/traveller/editions";
import type { AssignmentResolution, ResolutionTarget } from "./state";
import {
  buildPredicateContext, evaluatePredicate, type Predicate,
} from "@/lib/traveller/engine/predicate";

/** Parse a JSON cell value into a resolution target. The canonical forms
 *  in the MT data are:
 *    "auto"  — automatic success; no roll needed
 *    "none"  — no roll possible (the result type doesn't apply)
 *    "8+"    — throw 8 or higher on 2d6 to succeed
 *    "(8+)"  — same numeric target, but parenthesized means officers cannot roll
 *    "11 +"  — same as "11+" with whitespace artifact from PDF extraction
 *    8       — bare number; treated as the throw target
 *    null/empty — same as "none" */
export function parseResolutionTarget(raw: unknown): {
  target: ResolutionTarget;
  officersBarred: boolean;
} {
  if (raw === null || raw === undefined || raw === "") {
    return { target: "none", officersBarred: false };
  }
  if (typeof raw === "number") return { target: raw, officersBarred: false };
  const s = String(raw).trim();
  if (s.toLowerCase() === "auto") return { target: "auto", officersBarred: false };
  if (s.toLowerCase() === "none" || s === "-") {
    return { target: "none", officersBarred: false };
  }
  // Strip whitespace and trailing/leading punctuation, detect parentheses.
  const officersBarred = s.includes("(") && s.includes(")");
  const cleaned = s.replace(/[()]/g, "").replace(/\s+/g, "").replace(/\+$/, "");
  const n = parseInt(cleaned, 10);
  if (Number.isNaN(n)) {
    throw new Error(`Cannot parse resolution target ${JSON.stringify(raw)}`);
  }
  return { target: n, officersBarred };
}

/** Look up the resolution row for a specific assignment. The
 *  assignmentResolution structure puts assignment types as columns and
 *  result types (Survival/Decoration/Promotion/Skills) as rows. */
export function lookupResolution(
  resolution: {
    columns: string[];
    rows: Array<Record<string, unknown>>;
    dms?: StructuredDm[];
    notes?: string[];
  },
  assignment: string,
): AssignmentResolution {
  // Normalize the assignment label to match the JSON column key style.
  // Manual uses "Internal Security"; JSON columns use "internalSecurity".
  const colKey = labelToColumnKey(assignment);
  if (!resolution.columns.includes(colKey)) {
    throw new Error(
      `Assignment "${assignment}" (column key "${colKey}") not found in resolution table columns: ${resolution.columns.join(", ")}`,
    );
  }
  // Scout / Merchant resolution tables omit Decoration and/or Promotion
  // rows (the manual doesn't define those mechanics for those pathways).
  // A missing row means the result type is not applicable and returns "none".
  const rowFor = (resultName: string) =>
    resolution.rows.find(
      (r) => String(r.result).toLowerCase() === resultName.toLowerCase(),
    );
  const cellOr = (resultName: string): unknown => {
    const r = rowFor(resultName);
    return r ? r[colKey] : null;
  };

  const survival = parseResolutionTarget(cellOr("Survival"));
  const decoration = parseResolutionTarget(cellOr("Decoration"));
  const promotion = parseResolutionTarget(cellOr("Promotion"));
  const skills = parseResolutionTarget(cellOr("Skills"));

  return {
    survival: survival.target,
    decoration: decoration.target,
    promotion: promotion.target,
    skills: skills.target,
    promotionOfficersBarred: promotion.officersBarred,
  };
}

/** Convert a display label like "Internal Security" to the camelCase
 *  column key the JSON uses, "internalSecurity". */
export function labelToColumnKey(label: string): string {
  const trimmed = label.trim();
  // Already lowercase camelCase?
  if (/^[a-z][a-zA-Z]*$/.test(trimmed)) return trimmed;
  const parts = trimmed.split(/[\s-]+/).filter((p) => p.length > 0);
  return parts.map((p, i) => {
    const first = i === 0 ? p.charAt(0).toLowerCase() : p.charAt(0).toUpperCase();
    return first + p.slice(1);
  }).join("");
}

/** Sum the structured DM rules (from `dms` arrays in the JSON) that match
 *  the character, for a given roll type. Entries without `rollType` are
 *  general and apply to every roll type. */
export function applyDmRules(
  dms: StructuredDm[] | undefined,
  ch: Character,
  rollType: "survival" | "promotion" | "decoration" | "skills" | "bonus",
): number {
  if (!dms) return 0;
  const ctx = buildPredicateContext(ch);
  let total = 0;
  for (const rule of dms) {
    // rollType is a caller-side filter (not a condition): an entry without
    // one is general and applies to every roll type.
    if (rule.rollType !== undefined && rule.rollType !== rollType) continue;
    if (evaluatePredicate(rule, ctx)) total += rule.dm;
  }
  // PM p. 15: anagathics user takes a survival DM (a steeper one for the
  // noble service). Magnitudes live in JSON (rules.anagathics); mirror the
  // basic-chargen read in engine/serviceLoader.ts.
  if (rollType === "survival" &&
      (ch.anagathicsActiveThisTerm || ch.wantsAnagathicsThisTerm)) {
    const anag = getEdition(ch.editionId).rules.anagathics;
    const noblePenalty = anag?.nobleSurvivalDm;
    const standardPenalty = anag?.survivalDm ?? 0;
    const nobleService = anag?.nobleService;
    const isNoble = nobleService !== undefined && ch.service === nobleService;
    total += (isNoble && noblePenalty !== undefined) ? noblePenalty : standardPenalty;
  }
  return total;
}

/** A structured DM rule: a Predicate (the condition) plus the `dm` it
 *  contributes when the condition holds. `column` and `rollType` are
 *  caller-side filters, NOT conditions — the caller narrows by them before
 *  evaluating, so the interpreter ignores them. `note` is documentation. */
export interface StructuredDm extends Predicate {
  column?: string;
  rollType?: "survival" | "promotion" | "decoration" | "skills" | "bonus";
  note?: string;
  dm: number;
}

/** Sum the `dm` of every structured rule whose Predicate matches the
 *  character. Column-filtering callers narrow `rules` before calling. */
export function applyStructuredDms(
  rules: StructuredDm[] | undefined,
  ch: Character,
): number {
  if (!rules) return 0;
  const ctx = buildPredicateContext(ch);
  let total = 0;
  for (const r of rules) if (evaluatePredicate(r, ctx)) total += r.dm;
  return total;
}

