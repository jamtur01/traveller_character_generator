// Helpers for reading the assignment / resolution / branch tables that
// every ACG pathway declares in JSON. The shapes vary slightly per
// pathway, so these helpers normalize the lookups.

import { roll } from "../../random";
import type { Character } from "../../character";
import type {
  AssignmentResolution, AssignmentTable, ResolutionTarget,
} from "./types";

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

/** Roll 1d6 (modified) on an assignment table, picking the cell from the
 *  appropriate column. Returns the assignment label. */
export function rollAssignmentTable(
  table: AssignmentTable,
  columnKey: string,
  dm: number,
  rolledDie?: number,
): string {
  const die = rolledDie ?? roll(1);
  const total = Math.min(12, Math.max(1, die + dm));
  // Some tables (mercenary, navy) use 2..12 (2D). The 1D table for things
  // like scout office picks uses 1..6. The actual die count is encoded by
  // whether the rows go up to 12 or 6.
  const max = Math.max(...table.rows.map((r) => r.die));
  const clamped = Math.min(max, total);
  const row = table.rows.find((r) => r.die === clamped);
  if (!row) throw new Error(`No row in assignment table for die ${clamped}`);
  const cell = row[columnKey];
  if (typeof cell !== "string") {
    throw new Error(
      `Assignment table column "${columnKey}" row die=${clamped} is not a string: ${JSON.stringify(cell)}`,
    );
  }
  return cell;
}

/** Look up the resolution row for a specific assignment. The
 *  assignmentResolution structure puts assignment types as columns and
 *  result types (Survival/Decoration/Promotion/Skills) as rows. */
export function lookupResolution(
  resolution: {
    columns: string[];
    rows: Array<Record<string, unknown>>;
    dms?: string[];
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
  const rowFor = (resultName: string) => {
    const r = resolution.rows.find(
      (r) => String(r.result).toLowerCase() === resultName.toLowerCase(),
    );
    if (!r) throw new Error(`Resolution row "${resultName}" missing`);
    return r;
  };

  const survival = parseResolutionTarget(rowFor("Survival")[colKey]);
  const decoration = parseResolutionTarget(rowFor("Decoration")[colKey]);
  const promotion = parseResolutionTarget(rowFor("Promotion")[colKey]);
  const skills = parseResolutionTarget(rowFor("Skills")[colKey]);

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

/** Apply pathway-specific DM rules (parsed from `dms` arrays in the
 *  JSON) for a given roll type. These are free-form strings in the
 *  manual; the parser handles a handful of canonical forms. */
export function applyDmRules(
  dms: string[] | undefined,
  ch: Character,
  rollType: "survival" | "promotion" | "decoration" | "skills" | "bonus",
): number {
  if (!dms) return 0;
  let total = 0;
  for (const rule of dms) {
    const lc = rule.toLowerCase();
    if (!lc.includes(rollType.toLowerCase())) continue;
    total += parseDmRule(rule, ch);
  }
  return total;
}

/** Parse one DM rule string like "DM +1 if Edu 7+" or
 *  "DM + 1 if any MOS skill 2 +". Returns the DM if condition met else 0. */
export function parseDmRule(rule: string, ch: Character): number {
  // Extract the magnitude. The manual has "+1", "+ 1", "DM+1", etc.
  const magMatch = rule.match(/DM\s*([+-])\s*(\d+)/i);
  if (!magMatch) return 0;
  const sign = magMatch[1] === "-" ? -1 : 1;
  const mag = parseInt(magMatch[2]!, 10) * sign;

  // Attribute condition? "if Edu 7+" / "if Int 8+" / "if Strength 8 +"
  const attrMatch = rule.match(
    /if\s+(strength|str|dex(?:terity)?|end(?:urance)?|int(?:elligence)?|edu(?:cation)?|soc(?:ial)?)\s+(\d+)\s*\+/i,
  );
  if (attrMatch) {
    const attr = normalizeAttr(attrMatch[1]!);
    const threshold = parseInt(attrMatch[2]!, 10);
    if (ch.attributes[attr] >= threshold) return mag;
    return 0;
  }

  // Skill-level condition? "if any MOS skill 2+" / "if Steward-2+" /
  // "if Pilot-2+" / "if any department skill 2+"
  const skillMatch = rule.match(
    /if\s+(?:any\s+(?:MOS|department)\s+skill|([A-Z][\w' -]*?))(?:-|\s+)(\d+)\s*\+/i,
  );
  if (skillMatch) {
    if (skillMatch[1]) {
      // Specific skill name
      const skill = skillMatch[1]!.trim();
      const level = parseInt(skillMatch[2]!, 10);
      if (ch.checkSkillLevel(skill, level)) return mag;
      return 0;
    }
    // "any MOS skill" or "any department skill" — without per-character
    // MOS/department skill tracking we can't evaluate; treat as no-DM.
    return 0;
  }

  // Rank-based condition? "if rank E4+ or rank O1+"
  const rankMatch = rule.match(/if\s+rank\s+(E|O|IS-)(\d+)\s*\+/i);
  if (rankMatch) {
    // Without acgState available here, we can't check rank; caller should
    // handle rank-conditional DMs explicitly via getCommandDutyDm etc.
    return 0;
  }

  return 0;
}

function normalizeAttr(
  s: string,
): "strength" | "dexterity" | "endurance" | "intelligence" | "education" | "social" {
  const lc = s.toLowerCase();
  if (lc.startsWith("str")) return "strength";
  if (lc.startsWith("dex")) return "dexterity";
  if (lc.startsWith("end")) return "endurance";
  if (lc.startsWith("int")) return "intelligence";
  if (lc.startsWith("edu")) return "education";
  return "social";
}

/** Resolve a roll target into a 2d6 outcome: returns {success, margin, roll}.
 *  "auto" targets always succeed with margin=0. "none" targets never succeed. */
export function rollVsTarget(
  target: ResolutionTarget,
  dm: number,
): { success: boolean; margin: number; roll: number } {
  if (target === "auto") return { success: true, margin: 0, roll: 0 };
  if (target === "none") return { success: false, margin: -99, roll: 0 };
  const r = roll(2);
  const margin = r + dm - target;
  return { success: margin >= 0, margin, roll: r };
}
