// Helpers for reading the assignment / resolution / branch tables that
// every ACG pathway declares in JSON. The shapes vary slightly per
// pathway, so these helpers normalize the lookups.

import { roll } from "../../random";
import type { Character } from "../../character";
import { getEdition, getAcgPathway } from "../../editions";
import type {
  AssignmentResolution, AssignmentTable, ResolutionTarget,
} from "./state";

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
    dms?: Array<string | StructuredDm>;
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

/** Apply pathway-specific DM rules (parsed from `dms` arrays in the
 *  JSON) for a given roll type. These are free-form strings in the
 *  manual; the parser handles a handful of canonical forms. */
export function applyDmRules(
  dms: Array<string | StructuredDm> | undefined,
  ch: Character,
  rollType: "survival" | "promotion" | "decoration" | "skills" | "bonus",
): number {
  if (!dms) return 0;
  let total = 0;
  for (const rule of dms) {
    if (typeof rule === "string") {
      const lc = rule.toLowerCase();
      if (!lc.includes(rollType.toLowerCase())) continue;
      total += parseDmRule(rule, ch);
      continue;
    }
    // Structured DM: filter by rollType if the entry specifies one. Entries
    // without rollType are general (apply to every roll type), matching the
    // semantics already used by structured DMs on branchAssignment etc.
    if (rule.rollType !== undefined && rule.rollType !== rollType) continue;
    if (matchesStructuredDm(rule, ch)) total += rule.dm;
  }
  // PM p. 15: anagathics user takes -1 (-2 for nobles) survival DM.
  // Applies whether or not the supply is found; only on the survival roll.
  if (rollType === "survival" &&
      (ch.anagathicsActiveThisTerm || ch.wantsAnagathicsThisTerm)) {
    total += ch.service === "nobles" ? -2 : -1;
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

  // "if any MOS skill 2+": evaluate against the character's recorded
  // MOS plus the per-arm MOS column for their combat arm (read from the
  // pathway's mos table). Returns DM if any of those skills is at least
  // the listed level.
  const anyMosMatch = rule.match(/if\s+any\s+MOS\s+skill\s+(\d+)\s*\+/i);
  if (anyMosMatch) {
    const level = parseInt(anyMosMatch[1]!, 10);
    if (anyMosSkillAtLeast(ch, level)) return mag;
    return 0;
  }

  // "if any department skill 2+": evaluate against the Merchant Prince
  // department skill column for the character's department.
  const anyDeptMatch = rule.match(/if\s+any\s+department\s+skill\s+(\d+)\s*\+/i);
  if (anyDeptMatch) {
    const level = parseInt(anyDeptMatch[1]!, 10);
    if (anyDepartmentSkillAtLeast(ch, level)) return mag;
    return 0;
  }

  // Specific skill condition: "if Steward-2+" / "if Pilot 2+" etc.
  const skillMatch = rule.match(
    /if\s+([A-Z][\w' -]*?)(?:-|\s+)(\d+)\s*\+/i,
  );
  if (skillMatch) {
    const skill = skillMatch[1]!.trim();
    const level = parseInt(skillMatch[2]!, 10);
    if (ch.checkSkillLevel(skill, level)) return mag;
    return 0;
  }

  // Rank-based condition? "if rank E4+ or rank O1+"
  const rankMatch = rule.match(/if\s+rank\s+([A-Za-z-]+)(\d+)\s*\+/i);
  if (rankMatch) {
    const letter = rankMatch[1]!.toUpperCase().replace(/-$/, "");
    const want = parseInt(rankMatch[2]!, 10);
    const code = ch.acgState?.rankCode ?? "";
    const codeMatch = code.match(/^([A-Z-]+?)(\d+)$/);
    if (codeMatch && codeMatch[1]!.toUpperCase().replace(/-$/, "") === letter) {
      if (parseInt(codeMatch[2]!, 10) >= want) return mag;
    }
    return 0;
  }

  return 0;
}

function anyMosSkillAtLeast(ch: Character, level: number): boolean {
  // Direct MOS field (from initial training).
  const mos = ch.acgState?.mos;
  if (mos) {
    for (const [n, l] of ch.skills) if (n === mos && l >= level) return true;
  }
  // Cross-reference against the mercenary MOS column for the combat arm.
  const skills = mercenaryArmSkillSet(ch);
  for (const skill of skills) {
    for (const [n, l] of ch.skills) if (n === skill && l >= level) return true;
  }
  return false;
}

function anyDepartmentSkillAtLeast(ch: Character, level: number): boolean {
  const skills = merchantDepartmentSkillSet(ch);
  for (const skill of skills) {
    for (const [n, l] of ch.skills) if (n === skill && l >= level) return true;
  }
  return false;
}

function mercenaryArmSkillSet(ch: Character): Set<string> {
  const out = new Set<string>();
  const acg = ch.acgState;
  if (!acg) return out;
  const mercenary = getAcgPathway(ch.editionId, "mercenary");
  const mos = mercenary?.mos as {
    columns: string[]; rows: Array<Record<string, unknown>>;
  } | undefined;
  if (!mos) return out;
  const arm = acg.combatArm ?? "";
  const col = arm.charAt(0).toLowerCase() + arm.slice(1);
  for (const row of mos.rows) {
    const v = row[col];
    if (typeof v === "string") out.add(v);
  }
  return out;
}

function merchantDepartmentSkillSet(ch: Character): Set<string> {
  const out = new Set<string>();
  const acg = ch.acgState;
  if (!acg?.department) return out;
  const merchant = getAcgPathway(ch.editionId, "merchantPrince");
  const dept = (merchant?.skillTables as
    { department?: { columns: string[]; rows: Array<Record<string, unknown>> } }
    | undefined)?.department;
  if (!dept) return out;
  const col = acg.department.charAt(0).toLowerCase() + acg.department.slice(1);
  for (const row of dept.rows) {
    const v = row[col];
    if (typeof v === "string") out.add(v);
  }
  return out;
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

/** Structured DM rule shape used by branchAssignment, commandDuty,
 *  specialAssignments, and similar JSON blocks. Each entry contributes its
 *  `dm` if its condition holds. Conditions:
 *    - { attribute, min, dm }       — character's attribute ≥ min
 *    - { attribute, max, dm }       — character's attribute ≤ max
 *    - { rankAtLeast: "Ox"/"Ex", dm } — rank number ≥ N for that band
 *    - { rankAtMost:  "Ox"/"Ex", dm } — rank number ≤ N for that band
 *    - { officer: true, dm }
 *    - { enlisted: true, dm }
 *    - { inCommand: true, dm }
 *    - { service: "name", dm } / { service: ["a","b"], dm }
 *    - { fleet: "name", dm }
 *    - { skillAtLeast: { skill, level }, dm }                        */
export interface StructuredDm {
  attribute?: string;
  min?: number;
  max?: number;
  rankAtLeast?: string;
  rankAtMost?: string;
  officer?: boolean;
  enlisted?: boolean;
  inCommand?: boolean;
  service?: string | string[];
  fleet?: string;
  skillAtLeast?: { skill: string; level: number };
  /** Specific skill names are matched against ch.skills directly. */
  anyMosSkillAtLeast?: number;
  anyDepartmentSkillAtLeast?: number;
  /** Homeworld tech-code ≥ a named code in the tech-code-order. */
  homeworldTechAtLeast?: string;
  /** At least one of these combat arms is in acgState.crossTrainedArms. */
  crossTrainedInAny?: string[];
  /** Character's current combat arm is one of these. */
  currentCombatArmIn?: string[];
  /** Character's current branch is one of these. */
  currentBranchIn?: string[];
  /** Character's current department is one of these. */
  currentDepartmentIn?: string[];
  /** Character's current department is NOT one of these. */
  currentDepartmentNotIn?: string[];
  /** Character's number of terms is ≥ N. */
  termsAtLeast?: number;
  /** Optional column qualifier for tables whose DMs apply per-column
   *  (mercenary/navy serviceSkills). Callers that don't filter by column
   *  see every entry. */
  column?: string;
  /** True if the character has any of these schools/pre-careers recorded
   *  in acgState.schoolsAttended (used for "College or Academy graduate"
   *  conditions). */
  attendedAnyOf?: string[];
  /** When set, restricts this DM to one of survival/promotion/decoration/
   *  skills/bonus. applyDmRules filters by this; applyStructuredDms ignores
   *  it (callers without a rollType context see every entry). */
  rollType?: "survival" | "promotion" | "decoration" | "skills" | "bonus";
  /** Optional human-readable note retained from manual prose. */
  note?: string;
  dm: number;
}

export function applyStructuredDms(
  rules: StructuredDm[] | undefined,
  ch: Character,
): number {
  if (!rules) return 0;
  let total = 0;
  for (const r of rules) {
    if (matchesStructuredDm(r, ch)) total += r.dm;
  }
  return total;
}

function matchesStructuredDm(r: StructuredDm, ch: Character): boolean {
  if (r.attribute) {
    const k = normalizeAttr(r.attribute);
    const v = ch.attributes[k];
    if (r.min !== undefined && v < r.min) return false;
    if (r.max !== undefined && v > r.max) return false;
    if (r.min === undefined && r.max === undefined) return false;
  }
  const code = ch.acgState?.rankCode ?? "";
  if (r.rankAtLeast) {
    const want = parseRankLetter(r.rankAtLeast);
    const have = parseRankLetter(code);
    if (!want || !have || want.letter !== have.letter) return false;
    if (have.n < want.n) return false;
  }
  if (r.rankAtMost) {
    const want = parseRankLetter(r.rankAtMost);
    const have = parseRankLetter(code);
    if (!want || !have || want.letter !== have.letter) return false;
    if (have.n > want.n) return false;
  }
  if (r.officer === true && !ch.acgState?.isOfficer) return false;
  if (r.enlisted === true && ch.acgState?.isOfficer) return false;
  if (r.inCommand === true && !ch.acgState?.inCommand) return false;
  if (r.service !== undefined) {
    const services = Array.isArray(r.service) ? r.service : [r.service];
    if (!services.includes(ch.service)) return false;
  }
  if (r.fleet !== undefined) {
    if (ch.acgState?.fleet !== r.fleet) return false;
  }
  if (r.skillAtLeast) {
    let lvl = 0;
    for (const [n, l] of ch.skills) if (n === r.skillAtLeast.skill) lvl = l;
    if (lvl < r.skillAtLeast.level) return false;
  }
  if (r.anyMosSkillAtLeast !== undefined) {
    if (!anyMosSkillAtLeast(ch, r.anyMosSkillAtLeast)) return false;
  }
  if (r.anyDepartmentSkillAtLeast !== undefined) {
    if (!anyDepartmentSkillAtLeast(ch, r.anyDepartmentSkillAtLeast)) return false;
  }
  if (r.crossTrainedInAny) {
    const xtrain = ch.acgState?.crossTrainedArms ?? [];
    if (!r.crossTrainedInAny.some((a) => xtrain.includes(a))) return false;
  }
  if (r.currentCombatArmIn) {
    if (!r.currentCombatArmIn.includes(ch.acgState?.combatArm ?? "")) return false;
  }
  if (r.currentBranchIn) {
    if (!r.currentBranchIn.includes(ch.acgState?.branch ?? "")) return false;
  }
  if (r.currentDepartmentIn) {
    if (!r.currentDepartmentIn.includes(ch.acgState?.department ?? "")) return false;
  }
  if (r.currentDepartmentNotIn) {
    if (r.currentDepartmentNotIn.includes(ch.acgState?.department ?? "")) return false;
  }
  if (r.termsAtLeast !== undefined && ch.terms < r.termsAtLeast) return false;
  if (r.attendedAnyOf) {
    const schools = ch.acgState?.schoolsAttended ?? [];
    if (!r.attendedAnyOf.some((s) => schools.includes(s))) return false;
  }
  if (r.homeworldTechAtLeast) {
    const order = (getEdition(ch.editionId).data as {
      homeworld?: { techCodeOrder?: string[] };
    }).homeworld?.techCodeOrder;
    const hwTech = ch.homeworld?.tech;
    if (!order || !hwTech) return false;
    const want = order.indexOf(r.homeworldTechAtLeast);
    const have = order.indexOf(hwTech);
    if (want < 0 || have < 0 || have < want) return false;
  }
  return true;
}

function parseRankLetter(code: string): { letter: string; n: number } | null {
  const m = code.match(/^([A-Za-z]+-?)(\d+)$/);
  if (!m) return null;
  return { letter: m[1]!, n: parseInt(m[2]!, 10) };
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
