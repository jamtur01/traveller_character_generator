// Pre-career options for MT ACG. Per manual p. 47.
//
// College (any character):
//   Admission 9+ DM+2 if Edu 9+. Failure: drafted into Army for a short
//     (3-year) term.
//   Success 7+ DM+2 if Int 8+. Failure: character aged 1 year, can enlist.
//   OTC 8+ DM+1 if Soc 8+ — commissioned in Army/Marines on graduation.
//   NOTC 9+ DM+1 if Soc 10+ — commissioned in Navy on graduation.
//   Education 1D-2 (DM+1 if Int 9+) — gain that many Edu points.
//   Honors 10+ DM+1 if Int 10+ — Edu becomes 10 or +1 whichever greater.
//   Honors graduates can attempt Medical School / Flight School.
//
// Service Academies (Naval, Military, Merchant):
//   Each has Admission/Success/Education/Honors throws + automatic
//   skills granted on graduation. Honors gates Medical / Flight.
//
// Medical School (post-honors):
//   Admission 9+ DM+2 if Edu 10+, Success 8+ DM+2 if Edu 8+, Honors 11+
//   DM+1 if Edu 11+. All graduates: +1 Edu, Medical-3, Admin. Honors:
//   add Medical and Computer.
//
// Flight School (commissioned college honors or Naval Academy honors):
//   Admission 9+ DM+1 if Dex 9+. Success 7+ DM+1 if Int 8+. All grads:
//   Ship's Boat, Navigation, plus 1D-3 (min 1) Pilot.

import type { Character } from "../../character";
import { getEdition } from "../../editions";
import { extendedHex } from "../../formatting";
import { arnd, roll } from "../../random";
import { awardBrownie } from "./awards";
import { event as ev } from "../../history";
import type { AcgPathwayId } from "./types";

export type PreCareerOption =
  | "college" | "navalAcademy" | "militaryAcademy" | "merchantAcademy"
  | "medicalSchool" | "flightSchool";

/** Display label for a pre-career option key. Reads `displayName` from
 *  the edition's preCareerOptions JSON. The label is data, not code; if
 *  an edition declares the option without a displayName that's a data
 *  bug — surface it loudly rather than hiding behind a hardcoded
 *  fallback that drifts out of sync with the JSON. */
export function preCareerLabel(opt: PreCareerOption, editionId: string): string {
  const spec = specFor(editionId, opt);
  if (!spec?.displayName) {
    throw new Error(
      `Edition "${editionId}" preCareerOptions.${opt} is missing displayName. ` +
      `Add it to data/editions/${editionId}.json.`,
    );
  }
  return spec.displayName;
}

/** Pre-career attribute eligibility (e.g., Naval Academy requires Soc 8+).
 *  Returns null when no eligibility is declared (always eligible). */
export function preCareerEligibility(
  editionId: string, opt: PreCareerOption,
): { attribute: keyof Character["attributes"]; min: number } | null {
  const spec = specFor(editionId, opt);
  if (!spec?.eligibility) return null;
  const a = mapAttr(spec.eligibility.attribute);
  if (!a) return null;
  return { attribute: a, min: spec.eligibility.min };
}

/** True iff the character meets the pre-career option's attribute gates. */
export function isPreCareerEligible(
  ch: Character, opt: PreCareerOption,
): boolean {
  const gate = preCareerEligibility(ch.editionId, opt);
  if (!gate) return true;
  return ch.attributes[gate.attribute] >= gate.min;
}

/** UI summary text for the picker button. Reads `uiSummary` from JSON. */
export function preCareerUiSummary(
  editionId: string, opt: PreCareerOption,
): string {
  return specFor(editionId, opt)?.uiSummary ?? "";
}

interface ThrowSpec {
  target: number;
  dms: Array<{ attribute: string; min: number; dm: number }>;
}
interface EducationSpec {
  roll: string;
  dms: Array<{ attribute: string; min: number; dm: number }>;
}
interface HonorsSpec extends ThrowSpec { benefit?: string }
interface PreCareerSpec {
  displayName?: string;
  uiSummary?: string;
  eligibility?: { attribute: string; min: number };
  admission?: ThrowSpec;
  success?: ThrowSpec;
  otc?: ThrowSpec;
  notc?: ThrowSpec;
  education?: EducationSpec;
  honors?: HonorsSpec;
  [k: string]: unknown;
}

interface PreCareerResult {
  admitted: boolean;
  graduated: boolean;
  honors: boolean;
  commissioned: boolean;
  branch: "army" | "marines" | "navy" | "merchants" | null;
  /** Rank granted by graduation (PM p. 47: academies grant O1; Medical
   *  School graduates may take an automatic direct commission at O3). */
  commissionRank?: "O1" | "O3";
  skills: Array<[string, number]>;
  attributeChanges: Record<string, number>;
  /** Pathways the character can subsequently enter without normal
   *  enlistment (the academy "automatic enlistment" effect). */
  autoEnlistPathway: AcgPathwayId | null;
  ageGainedYears: number;
  /** PM p. 47: a character whose pre-career path failed enters their
   *  first term as a short (three-year) term rather than the usual four. */
  firstTermShort: boolean;
  /** PM p. 47: academy admission/success failures draft the character
   *  into a specific service for their first term. */
  draftedInto: "army" | "navy" | "marines" | null;
  /** PM p. 47: medical-school graduates may take an automatic direct
   *  commission as rank O3. Tracked separately from `commissionRank`
   *  in case future variants offer it optionally. */
  medicalDirectCommission: boolean;
  notes: string[];
}

/** Honors gates: medical school requires honors from college, naval
 *  academy, or military academy. Flight school requires a commissioned
 *  college honors graduate (i.e. college honors + NOTC/OTC commission),
 *  any Naval Academy graduate (honors or not), or any character holding
 *  a NOTC/Merchant Academy commission (PM p. 47). */
function honorsPrereqMet(ch: Character, opt: PreCareerOption): boolean {
  const honors = ch.acgState?.honorsGraduations ?? [];
  const schools = ch.acgState?.schoolsAttended ?? [];
  if (opt === "medicalSchool") {
    return honors.includes("college") || honors.includes("navalAcademy") ||
      honors.includes("militaryAcademy");
  }
  if (opt === "flightSchool") {
    const hasCommission =
      ch.acgState?.preCareerCommission === true || ch.commissioned;
    const collegeHonorsCommissioned =
      honors.includes("college") && hasCommission;
    const naAnyGrad = schools.includes("navalAcademy");
    const merchantAcademyCommissioned =
      schools.includes("merchantAcademy") && hasCommission;
    return collegeHonorsCommissioned || naAnyGrad || merchantAcademyCommissioned;
  }
  return true;
}

function specFor(editionId: string, opt: PreCareerOption): PreCareerSpec | null {
  const acg = getEdition(editionId).data.advancedCharacterGeneration;
  const pco = acg?.common?.preCareerOptions?.[opt];
  return (pco as PreCareerSpec | undefined) ?? null;
}

function applyDms(
  dms: Array<{ attribute: string; min: number; dm: number }> | undefined,
  ch: Character,
): number {
  if (!dms) return 0;
  let total = 0;
  for (const d of dms) {
    const a = mapAttr(d.attribute);
    if (!a) continue;
    if (ch.attributes[a] >= d.min) total += d.dm;
  }
  return total;
}

function mapAttr(s: string): keyof Character["attributes"] | null {
  const lc = s.toLowerCase();
  if (lc === "strength") return "strength";
  if (lc === "dexterity") return "dexterity";
  if (lc === "endurance") return "endurance";
  if (lc === "intelligence") return "intelligence";
  if (lc === "education") return "education";
  if (lc === "socialstanding" || lc === "social") return "social";
  return null;
}

/** Attempt a pre-career option. Returns a structured result. The caller
 *  applies the result via applyPreCareerResult(). */
export function attemptPreCareer(ch: Character, opt: PreCareerOption): PreCareerResult {
  const spec = specFor(ch.editionId, opt);
  const out: PreCareerResult = {
    admitted: false, graduated: false, honors: false, commissioned: false,
    branch: null, skills: [], attributeChanges: {},
    autoEnlistPathway: null, ageGainedYears: 0,
    firstTermShort: false, draftedInto: null, medicalDirectCommission: false,
    notes: [],
  };
  if (!spec) {
    out.notes.push(`No pre-career data for "${opt}"`);
    return out;
  }
  // Honors gate for Medical / Flight school (PM p. 47).
  if (!honorsPrereqMet(ch, opt)) {
    out.notes.push(
      opt === "medicalSchool"
        ? "Medical School requires honors graduation from college or a service academy."
        : "Flight School requires a commissioned college honors graduate, a Naval Academy graduate, or a commissioned Merchant Academy graduate.",
    );
    return out;
  }
  // Merchant Academy gate (PM p. 44): "A character who has enlisted in a
  // Megacorporation or a Sector-wide line may apply for admission to a
  // Merchant Academy." Block admission if those conditions aren't met.
  if (opt === "merchantAcademy") {
    const lineType = ch.acgState?.lineType;
    const allowed = lineType === "Megacorp" || lineType === "Sector-wide";
    if (!allowed) {
      out.notes.push(
        `Merchant Academy requires enlistment in a Megacorporation or Sector-wide line ` +
        `first; current line is ${lineType ?? "(none)"}.`,
      );
      return out;
    }
  }

  // Rrev11: Social-standing eligibility gates per PM p. 47.
  //   Naval Academy: Social 8+ required to apply.
  //   Military Academy: Social 6+ required to apply.
  // Failing the gate is "may not apply" — character isn't aged or drafted,
  // they simply can't enter (different from admission-roll failure).
  if (opt === "navalAcademy" && ch.attributes.social < 8) {
    out.notes.push("Naval Academy requires Social Standing 8+.");
    return out;
  }
  if (opt === "militaryAcademy" && ch.attributes.social < 6) {
    out.notes.push("Military Academy requires Social Standing 6+.");
    return out;
  }

  // Rrev4: Flight School admission is automatic for commissioned college
  // honors graduates and Naval Academy honors graduates (PM p. 47:
  // "Any commissioned college honors graduate or Naval Academy graduate
  // with honors may attend flight school simply by applying"). Other
  // Naval Academy graduates (without honors) and commissioned Merchant
  // Academy graduates must roll for admission.
  const flightAutoAdmit = opt === "flightSchool" && (() => {
    const honors = ch.acgState?.honorsGraduations ?? [];
    const hasCommission =
      ch.acgState?.preCareerCommission === true || ch.commissioned;
    return (honors.includes("college") && hasCommission) ||
      honors.includes("navalAcademy");
  })();

  // Admission.
  if (spec.admission && !flightAutoAdmit) {
    const dm = applyDms(spec.admission.dms, ch);
    const r = roll(2);
    const succeeded = r + dm >= spec.admission.target;
    ch.log(ev.roll(
      `${preCareerLabel(opt, ch.editionId)} admission`,
      r, dm, spec.admission.target, succeeded,
    ));
    if (!succeeded) {
      out.notes.push("Admission denied — may attempt another option or enlist normally.");
      // Rrev11: PM p. 47 distinguishes admission failure from success
      // failure. Admission failure = the school didn't accept you; you
      // simply try another path, NO aging, NO draft. Aging and the forced
      // short-term draft apply only on success-failure (washed out after
      // being accepted).
      return out;
    }
    out.admitted = true;
  } else {
    out.admitted = true;
    // Flight School auto-admit (commissioned college honors / Naval Academy
    // honors, PM p. 47) is silent here; the downstream ev.preCareer events
    // record graduation/honors.
  }

  // Success.
  if (spec.success) {
    const dm = applyDms(spec.success.dms, ch);
    const r = roll(2);
    const succeeded = r + dm >= spec.success.target;
    ch.log(ev.roll(
      `${preCareerLabel(opt, ch.editionId)} success`,
      r, dm, spec.success.target, succeeded,
    ));
    if (!succeeded) {
      out.notes.push("Did not complete the course.");
      out.ageGainedYears += 1;
      // PM p. 47 success-failure outcomes:
      //   College: age 19, first term short.
      //   Naval Academy: age 19, drafted Navy, short term.
      //   Military Academy: age 19, drafted Army, short term.
      //   Merchant Academy: age 19, drafted Army, short term.
      //   Medical School: age 23, may enlist normally OR short term if academy grad.
      //   Flight School: age (varies), reports for duty in Navy/Marines (short).
      out.firstTermShort = true;
      if (opt === "navalAcademy") out.draftedInto = "navy";
      else if (opt === "militaryAcademy" || opt === "merchantAcademy") out.draftedInto = "army";
      else if (opt === "flightSchool") out.draftedInto = "navy";
      return out;
    }
    out.graduated = true;
  } else {
    out.graduated = true;
  }

  // Successful graduates age according to course length (PM p. 47):
  //   college / academies: 4 years (entered at 18, graduates at 22)
  //   medical school: 4 years (graduates at 26 — entered post-honors at 22)
  //   flight school: 1 year (no explicit duration in PM; treated as a
  //     short specialty course)
  if (opt === "college" || opt === "navalAcademy" ||
      opt === "militaryAcademy" || opt === "merchantAcademy" ||
      opt === "medicalSchool") {
    out.ageGainedYears += 4;
  } else if (opt === "flightSchool") {
    out.ageGainedYears += 1;
    // PM p. 47: "when the character reports for duty, he or she begins
    // serving a short term and enters basic officer training." Flight
    // school graduates always serve a short first term in their pathway.
    out.firstTermShort = true;
  }

  // OTC / NOTC (college only, voluntary).
  if (opt === "college") {
    if (spec.otc) {
      const dm = applyDms(spec.otc.dms, ch);
      const r = roll(2);
      if (r + dm >= spec.otc.target) {
        out.commissioned = true;
        out.autoEnlistPathway = "mercenary";
        ch.log(ev.promoted("O1", "OTC"));
        // F15 — PM p. 47 line 2782-2783: "A character in OTC is
        // automatically enlisted in (and commissioned as an officer in)
        // the Army or the Marines." Branch is a player choice.
        if (ch.choiceMode === "interactive") {
          ch.pickOrDefer({
            kind: "cascade",
            label: "OTC commission — choose your service branch",
            options: ["Army", "Marines"],
            preferred: ["Army"],
            context: { source: "otcBranch" },
            onResolve: (c, chosen) => {
              const branch = chosen === "Marines" ? "marines" : "army";
              c.requireAcgState().preCareerBranch = branch;
              c.log(ev.promoted("O1", `OTC (${chosen})`));
            },
          });
          // Pending choice — set a default so non-pause callers see something.
          out.branch = "army";
          out.notes.push("OTC commission earned (branch pending choice).");
        } else {
          out.branch = "army";
          out.notes.push("OTC commission earned (Army by default; player may select Army or Marines).");
        }
      }
    }
    if (!out.commissioned && spec.notc) {
      const dm = applyDms(spec.notc.dms, ch);
      const r = roll(2);
      if (r + dm >= spec.notc.target) {
        out.commissioned = true;
        out.branch = "navy";
        out.autoEnlistPathway = "navy";
        out.notes.push("NOTC commission earned (Navy).");
        ch.log(ev.promoted("O1", "NOTC"));
      }
    }
  }

  // Education increase.
  if (spec.education) {
    const dm = applyDms(spec.education.dms, ch);
    // Parse "1D-2" / "1D-3" — the constant offset.
    const m = spec.education.roll.match(/^1D([-+]\d+)$/);
    const offset = m ? parseInt(m[1]!, 10) : 0;
    const gain = Math.max(1, roll(1) + offset + dm);
    out.attributeChanges.education = (out.attributeChanges.education ?? 0) + gain;
    // Applied by applyPreCareerResult via improveAttribute → ev.attributeChange.
  }

  // Honors throw.
  if (spec.honors) {
    const dm = applyDms(spec.honors.dms, ch);
    const r = roll(2);
    if (r + dm >= spec.honors.target) {
      out.honors = true;
      out.notes.push("Graduated with honors.");
      // Honors benefits per the manual:
      if (opt === "college") {
        // PM p. 47 "raises Education to 10 or +1, whichever greater."
        // Read literally: the honors bump SETS Education to
        // max(10, currentEdu + 1) — it's an OR, not a stack on top of
        // the regular education roll. The education roll (1D-3) and
        // the honors bump are alternative paths to the same Edu value.
        // Take the larger of (existing roll, honors target) so honors
        // never makes the character worse off than the plain roll.
        const target = Math.max(10, ch.attributes.education + 1);
        const honorsDelta = target - ch.attributes.education;
        const rollDelta = out.attributeChanges.education ?? 0;
        out.attributeChanges.education = Math.max(honorsDelta, rollDelta);
      }
      // ev.preCareer(opt, "honors") is emitted by applyPreCareerResult.
    }
  }

  // Per-option skills / commissions.
  applyOptionSpecifics(ch, opt, out);

  // Academy auto-commission: per the manual, all academy graduates
  // (Military/Naval/Merchant) receive a commission at rank O1.
  if (opt === "militaryAcademy") {
    out.commissioned = true;
    out.branch = "army";
    out.commissionRank = "O1";
    out.autoEnlistPathway = "mercenary";
  } else if (opt === "navalAcademy") {
    out.commissioned = true;
    out.branch = "navy";
    out.commissionRank = "O1";
    out.autoEnlistPathway = "navy";
  } else if (opt === "merchantAcademy") {
    out.commissioned = true;
    out.branch = "merchants";
    out.commissionRank = "O1";
    out.autoEnlistPathway = "merchantPrince";
  } else if (opt === "medicalSchool" && out.graduated) {
    // PM p. 47: "He may apply for a direct commission (which is granted
    // automatically) as rank O3 in the Navy (Medical Branch), Army,
    // Scouts, or Merchants (Purser Department Medic). Marines have no
    // medical officers; they are treated by Navy doctors." Branch is
    // a player choice; in interactive mode we queue a pendingChoice,
    // in auto mode we default to Navy (Medical Branch).
    out.commissioned = true;
    out.commissionRank = "O3";
    out.medicalDirectCommission = true;
    if (ch.choiceMode === "interactive") {
      ch.pickOrDefer({
        kind: "cascade",
        label: "Medical School direct commission — choose service branch",
        options: ["Navy (Medical Branch)", "Army", "Scouts", "Merchants (Purser)"],
        preferred: ["Navy (Medical Branch)"],
        context: { source: "medicalCommission" },
        onResolve: (c, chosen) => {
          if (chosen === "Army") {
            c.requireAcgState().preCareerBranch = "army";
            c.acgPathway = "mercenary";
          } else if (chosen === "Scouts") {
            // Scout branch isn't a value in the union — store separately.
            c.requireAcgState().preCareerBranch = null;
            c.acgPathway = "scout";
          } else if (chosen === "Merchants (Purser)") {
            c.requireAcgState().preCareerBranch = "merchants";
            c.acgPathway = "merchantPrince";
          } else {
            c.requireAcgState().preCareerBranch = "navy";
            c.acgPathway = "navy";
          }
        },
      });
      // Default while choice is pending: navy.
      out.branch = "navy";
      out.autoEnlistPathway = "navy";
    } else {
      out.branch = "navy";
      out.autoEnlistPathway = "navy";
    }
  }

  return out;
}

/** Skills awarded by each option's table on graduation. All data is read
 *  from common.preCareerOptions in the edition JSON. Per manual p. 47. */
function applyOptionSpecifics(
  ch: Character,
  opt: PreCareerOption,
  out: PreCareerResult,
): void {
  const acg = getEdition(ch.editionId).data.advancedCharacterGeneration;
  const pco = acg?.common?.preCareerOptions?.[opt] as
    Record<string, unknown> | undefined;
  if (!pco) return;

  // Automatic skills granted to all graduates (e.g. Combat Rifleman for
  // Military Academy; Medical-3/Admin/+1 Edu for Medical School).
  applyAutomaticSkills(out, pco.automaticSkills as unknown);

  // 1D throw for each listed skill (Naval/Military Academy).
  const sk = pco.skills as
    | { throw?: string; skills?: string[]; rule?: string }
    | string[]
    | undefined;
  if (sk && !Array.isArray(sk) && Array.isArray(sk.skills) && sk.throw) {
    const target = parseSkillThrowTarget(sk.throw);
    for (const skill of sk.skills) {
      if (parseDieExpression(skill) !== null) {
        // Dynamic skill spec (e.g. "1D-3 levels of Pilot, minimum 1").
        out.skills.push(parseDynamicSkill(skill));
      } else if (roll(1) >= target) {
        out.skills.push([skill, 1]);
      }
    }
  }

  // Plain skill list with no throw (Flight School: Ship's Boat, Navigation,
  // and a dynamic "1D-3 levels of Pilot, minimum 1").
  if (sk && !Array.isArray(sk) && Array.isArray(sk.skills) && !sk.throw) {
    for (const skill of sk.skills) {
      if (parseDieExpression(skill) !== null) {
        out.skills.push(parseDynamicSkill(skill));
      } else {
        out.skills.push([skill, 1]);
      }
    }
  }
  if (Array.isArray(sk)) {
    for (const skill of sk) {
      if (parseDieExpression(skill) !== null) {
        out.skills.push(parseDynamicSkill(skill));
      } else {
        out.skills.push([skill, 1]);
      }
    }
  }

  // Merchant Academy: "Select one Merchant department and throw for three
  // department skills." This requires the Merchant Prince skill tables.
  if (sk && !Array.isArray(sk) && sk.rule && /department/i.test(sk.rule)) {
    applyMerchantDepartmentSkills(ch, out);
  }

  // Honors-only skills (e.g. Medical School honors → Medical + Computer).
  if (out.honors) {
    applyAutomaticSkills(out, pco.honorsSkills as unknown);
  }
}

/** Apply a list of skill descriptors. Each entry is "<Skill>", "<Skill>-<N>",
 *  or "+N <Attribute>" / "+<N> <Attribute>". */
function applyAutomaticSkills(out: PreCareerResult, raw: unknown): void {
  if (!Array.isArray(raw)) return;
  for (const entry of raw as string[]) {
    const attrMatch = entry.match(/^\+(\d+)\s+(.+)$/);
    if (attrMatch) {
      const delta = parseInt(attrMatch[1]!, 10);
      const attr = mapAttr(attrMatch[2]!);
      if (attr) {
        out.attributeChanges[attr] = (out.attributeChanges[attr] ?? 0) + delta;
      }
      continue;
    }
    const sklMatch = entry.match(/^(.+?)-(\d+)$/);
    if (sklMatch) {
      out.skills.push([sklMatch[1]!, parseInt(sklMatch[2]!, 10)]);
      continue;
    }
    out.skills.push([entry, 1]);
  }
}

function parseSkillThrowTarget(throwStr: string): number {
  const m = throwStr.match(/(\d+)\+/);
  return m ? parseInt(m[1]!, 10) : 4;
}

/** Recognise embedded die expressions in skill strings (e.g. "1D-3"). */
function parseDieExpression(s: string): number | null {
  const m = s.match(/(\d+)D([-+]\d+)?/);
  if (!m) return null;
  const offset = m[2] ? parseInt(m[2], 10) : 0;
  return roll(1) + offset;
}

/** Parse a dynamic skill spec like "1D-3 levels of Pilot, minimum 1". */
function parseDynamicSkill(s: string): [string, number] {
  const die = parseDieExpression(s) ?? 1;
  const minMatch = s.match(/minimum\s+(\d+)/i);
  const min = minMatch ? parseInt(minMatch[1]!, 10) : 1;
  const value = Math.max(min, die);
  // Extract the skill name — strip die expr and 'levels of' and 'minimum N'.
  const cleaned = s
    .replace(/\d+D[-+]?\d*\s*/g, "")
    .replace(/levels\s+of\s+/i, "")
    .replace(/,\s*minimum\s+\d+/i, "")
    .trim();
  return [cleaned, value];
}

/** Merchant Academy: select one of five Merchant departments and throw 4+
 *  on 1D three times on that department's skill column (manual p. 47, with
 *  data sourced from advancedCharacterGeneration.merchantPrince.skillTables.department).
 */
function applyMerchantDepartmentSkills(ch: Character, out: PreCareerResult): void {
  const acg = getEdition(ch.editionId).data.advancedCharacterGeneration;
  const dept = (acg?.merchantPrince?.skillTables as
    { department?: { columns: string[]; rows: Array<Record<string, unknown>> } }
    | undefined)?.department;
  if (!dept) return;
  const departments = dept.columns.filter((c) => c !== "die");
  if (departments.length === 0) return;
  // Skill-attempt parameters from the Academy spec (JSON pco.skills).
  const pco = acg?.common?.preCareerOptions?.merchantAcademy as
    { skills?: { throwTarget?: number; rolls?: number } } | undefined;
  const skillsSpec = pco?.skills;
  const skillsTarget = skillsSpec?.throwTarget ?? 4;
  const skillsCount = skillsSpec?.rolls ?? 3;
  const apply = (choice: string): void => {
    out.notes.push(`Merchant department: ${choice}`);
    // PM p. 47: "may select the department to which he will be assigned"
    // — record the player's pick so the post-enlistment flow doesn't
    // re-roll department assignment.
    if (ch.acgState) ch.acgState.department = choice;
    for (let i = 0; i < skillsCount; i++) {
      if (roll(1) >= skillsTarget) {
        const r = roll(1);
        const row = dept.rows.find((row) => row.die === r);
        const skill = row?.[choice];
        if (typeof skill === "string") out.skills.push([skill, 1]);
      }
    }
  };
  if (ch.choiceMode === "interactive") {
    ch.pickOrDefer({
      kind: "merchantDepartment",
      label: "Merchant Academy: choose your department.",
      options: departments,
      onResolve: (_c, choice) => apply(choice),
    });
    return;
  }
  apply(arnd(departments));
}

/** Apply a pre-career result to the character. Mutates state. */
export function applyPreCareerResult(ch: Character, opt: PreCareerOption, r: PreCareerResult): void {
  // Record the attempt regardless of outcome so the picker UI can remove
  // this option — RAW doesn't allow re-applying to the same school after
  // admission failure / washout.
  if (ch.acgState) {
    ch.acgState.schoolsAttempted = ch.acgState.schoolsAttempted ?? [];
    if (!ch.acgState.schoolsAttempted.includes(opt)) {
      ch.acgState.schoolsAttempted.push(opt);
    }
  }
  ch.age += r.ageGainedYears;
  for (const [attr, delta] of Object.entries(r.attributeChanges)) {
    const a = attr as keyof Character["attributes"];
    // Clamp both ends (PM caps Edu at 15; negative deltas shouldn't push
    // attributes below 0 even though pre-career deltas are normally
    // positive — be defensive in case a future option declares one).
    ch.attributes[a] = Math.max(0, Math.min(15, ch.attributes[a] + delta));
    ch.log(ev.attributeChange(
      attr, delta, `now ${extendedHex(ch.attributes[a])}`,
    ));
  }
  for (const [skill, lvl] of r.skills) {
    ch.addSkill(skill, lvl, preCareerLabel(opt, ch.editionId));
  }
  // Pre-career outcome notes describe what happened at the school. Map
  // each note to the typed preCareer event result kind so the renderer
  // can format them consistently.
  for (const note of r.notes) {
    const lc = note.toLowerCase();
    let result: "denied" | "washedOut" | "graduated" | "honors" | "info";
    if (lc.startsWith("admission denied")) result = "denied";
    else if (lc.startsWith("did not complete")) result = "washedOut";
    else result = "info";
    ch.log(ev.preCareer(preCareerLabel(opt, ch.editionId), result, note));
  }
  if (r.graduated && !r.honors) {
    ch.log(ev.preCareer(preCareerLabel(opt, ch.editionId), "graduated"));
  }
  if (r.honors) {
    ch.log(ev.preCareer(preCareerLabel(opt, ch.editionId), "honors"));
  }
  // Brownie point awards per the manual: 1 BP for graduation from
  // college / service academy / medical / flight school; +1 for honors.
  if (r.graduated && (opt === "college" || opt === "navalAcademy" ||
      opt === "militaryAcademy" || opt === "merchantAcademy" ||
      opt === "medicalSchool" || opt === "flightSchool")) {
    awardBrownie(ch, 1, `Graduated from ${preCareerLabel(opt, ch.editionId)}`);
  }
  if (r.honors) {
    awardBrownie(ch, 1, `Honors graduate of ${preCareerLabel(opt, ch.editionId)}`);
  }
  // Pre-career commission carries into ACG enlistment: subsequent beginAcg
  // honors this rank by skipping the default E1 reset.
  if (r.commissioned && ch.acgState) {
    ch.acgState.isOfficer = true;
    ch.acgState.rankCode = r.commissionRank ?? "O1";
    ch.acgState.preCareerCommission = true;
    ch.acgState.preCareerBranch = r.branch ?? null;
  }
  // Record graduations on acgState so pathways can detect them (e.g. Navy
  // medical/flight school graduates get auto-branch). Honors is tracked
  // separately because it gates Commando entry, Medical/Flight School
  // admission, Scout IS-10, and Merchant Academy department choice.
  if (r.graduated && ch.acgState) {
    if (!ch.acgState.schoolsAttended.includes(opt)) {
      ch.acgState.schoolsAttended.push(opt);
    }
    if (r.honors) {
      ch.acgState.honorsGraduations = ch.acgState.honorsGraduations ?? [];
      if (!ch.acgState.honorsGraduations.includes(opt)) {
        ch.acgState.honorsGraduations.push(opt);
      }
    }
  }
  // PM p. 47 failure outcomes: drafted into a service for a short
  // (three-year) first term. Record on acgState so beginAcg / first-term
  // logic can apply both effects.
  if (r.firstTermShort && ch.acgState) {
    ch.acgState.preCareerFirstTermShort = true;
  }
  if (r.draftedInto && ch.acgState) {
    ch.acgState.preCareerDraftedInto = r.draftedInto;
  }
}
