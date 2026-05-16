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
import { roll } from "../../random";
import { awardBrownie } from "./awards";
import type { AcgPathwayId } from "./types";

export type PreCareerOption =
  | "college" | "navalAcademy" | "militaryAcademy" | "merchantAcademy"
  | "medicalSchool" | "flightSchool";

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
  admission?: ThrowSpec;
  success?: ThrowSpec;
  otc?: ThrowSpec;
  notc?: ThrowSpec;
  education?: EducationSpec;
  honors?: HonorsSpec;
}

interface PreCareerResult {
  admitted: boolean;
  graduated: boolean;
  honors: boolean;
  commissioned: boolean;
  branch: "army" | "marines" | "navy" | "merchants" | null;
  skills: Array<[string, number]>;
  attributeChanges: Record<string, number>;
  /** Pathways the character can subsequently enter without normal
   *  enlistment (the academy "automatic enlistment" effect). */
  autoEnlistPathway: AcgPathwayId | null;
  ageGainedYears: number;
  notes: string[];
}

function specFor(editionId: string, opt: PreCareerOption): PreCareerSpec | null {
  const acg = getEdition(editionId).data.advancedCharacterGeneration as
    Record<string, unknown> | undefined;
  if (!acg) return null;
  const common = acg.common as { preCareerOptions?: Record<string, unknown> };
  const pco = common.preCareerOptions?.[opt];
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
    autoEnlistPathway: null, ageGainedYears: 0, notes: [],
  };
  if (!spec) {
    out.notes.push(`No pre-career data for "${opt}"`);
    return out;
  }

  // Admission.
  if (spec.admission) {
    const dm = applyDms(spec.admission.dms, ch);
    const r = roll(2);
    if (r + dm < spec.admission.target) {
      ch.verboseHistory(`${opt} admission FAILED (${r}+${dm} vs ${spec.admission.target}+)`);
      out.notes.push("Admission denied.");
      // College: drafted into Army for short term. Naval/Military/Merchant
      // Academy: aged 1 year, drafted.
      if (opt === "militaryAcademy" || opt === "navalAcademy" ||
          opt === "merchantAcademy") {
        out.ageGainedYears += 1;
      }
      return out;
    }
    out.admitted = true;
    ch.verboseHistory(`${opt} admission passed (${r}+${dm} vs ${spec.admission.target}+)`);
  } else {
    out.admitted = true;
  }

  // Success.
  if (spec.success) {
    const dm = applyDms(spec.success.dms, ch);
    const r = roll(2);
    if (r + dm < spec.success.target) {
      ch.verboseHistory(`${opt} success FAILED (${r}+${dm} vs ${spec.success.target}+)`);
      out.notes.push("Did not complete the course.");
      out.ageGainedYears += 1;
      return out;
    }
    out.graduated = true;
    ch.verboseHistory(`${opt} success passed (${r}+${dm} vs ${spec.success.target}+)`);
  } else {
    out.graduated = true;
  }

  // OTC / NOTC (college only, voluntary).
  if (opt === "college") {
    if (spec.otc) {
      const dm = applyDms(spec.otc.dms, ch);
      const r = roll(2);
      if (r + dm >= spec.otc.target) {
        out.commissioned = true;
        out.branch = "army"; // OTC -> Army/Marines commission
        out.autoEnlistPathway = "mercenary";
        out.notes.push("OTC commission earned (Army/Marines).");
        ch.verboseHistory(`OTC commission earned`);
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
        ch.verboseHistory(`NOTC commission earned`);
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
    ch.verboseHistory(`${opt} education gain: +${gain} Edu`);
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
        // Edu becomes 10 or +1 whichever greater. We compute against
        // current education + applied changes from this attempt.
        const projectedEdu = ch.attributes.education + (out.attributeChanges.education ?? 0);
        const target = Math.max(10, projectedEdu + 1);
        const delta = target - ch.attributes.education;
        out.attributeChanges.education = delta;
      }
      ch.verboseHistory(`${opt} honors achieved`);
    }
  }

  // Per-option skills / commissions.
  applyOptionSpecifics(ch, opt, out);

  // Academy auto-commission: per the manual, all academy graduates
  // (Military/Naval/Merchant) receive a commission at rank O1.
  if (opt === "militaryAcademy") {
    out.commissioned = true;
    out.branch = "army";
    out.autoEnlistPathway = "mercenary";
  } else if (opt === "navalAcademy") {
    out.commissioned = true;
    out.branch = "navy";
    out.autoEnlistPathway = "navy";
  } else if (opt === "merchantAcademy") {
    out.commissioned = true;
    out.branch = "merchants";
    out.autoEnlistPathway = "merchantPrince";
  }

  return out;
}

/** Skills awarded by each option's table on graduation. Per manual p. 47. */
function applyOptionSpecifics(
  ch: Character,
  opt: PreCareerOption,
  out: PreCareerResult,
): void {
  switch (opt) {
    case "navalAcademy": {
      // Roll 4+ on 1D for each of Vacc Suit, Navigation, Engineering.
      for (const skill of ["Vacc Suit", "Navigation", "Engineering"]) {
        if (roll(1) >= 4) out.skills.push([skill, 1]);
      }
      return;
    }
    case "militaryAcademy": {
      // All graduates receive Combat Rifleman. 4+ on 1D for each of
      // Tactics, Leader, Admin, Heavy Weapons, Forward Observer, Computer.
      out.skills.push(["Combat Rifleman", 1]);
      for (const skill of ["Tactics", "Leader", "Admin", "Heavy Weapons",
        "Forward Observer", "Computer"]) {
        if (roll(1) >= 4) out.skills.push([skill, 1]);
      }
      return;
    }
    case "merchantAcademy": {
      // Throw for three department skills — simplified: 4+ for each of
      // the canonical merchant skills.
      for (const skill of ["Steward", "Liaison", "Trader"]) {
        if (roll(1) >= 4) out.skills.push([skill, 1]);
      }
      return;
    }
    case "medicalSchool": {
      // All graduates: +1 Education, Medical-3, Admin. Honors adds
      // Medical and Computer.
      out.attributeChanges.education = (out.attributeChanges.education ?? 0) + 1;
      out.skills.push(["Medical", 3]);
      out.skills.push(["Admin", 1]);
      if (out.honors) {
        out.skills.push(["Medical", 1]);
        out.skills.push(["Computer", 1]);
      }
      return;
    }
    case "flightSchool": {
      // Ship's Boat, Navigation, 1D-3 (min 1) Pilot.
      out.skills.push(["Ship's Boat", 1]);
      out.skills.push(["Navigation", 1]);
      const pilot = Math.max(1, roll(1) - 3);
      out.skills.push(["Pilot", pilot]);
      return;
    }
    default:
      return;
  }
}

/** Apply a pre-career result to the character. Mutates state. */
export function applyPreCareerResult(ch: Character, opt: PreCareerOption, r: PreCareerResult): void {
  ch.age += r.ageGainedYears;
  for (const [attr, delta] of Object.entries(r.attributeChanges)) {
    const a = attr as keyof Character["attributes"];
    ch.attributes[a] = Math.min(15, ch.attributes[a] + delta);
    ch.verboseHistory(`+${delta} ${attr}`);
  }
  for (const [skill, lvl] of r.skills) {
    ch.addSkill(skill, lvl);
  }
  for (const note of r.notes) {
    ch.history.push(`${opt}: ${note}`);
  }
  // Brownie point awards per the manual: 1 BP for graduation from
  // college / service academy / medical / flight school; +1 for honors.
  if (r.graduated && (opt === "college" || opt === "navalAcademy" ||
      opt === "militaryAcademy" || opt === "merchantAcademy" ||
      opt === "medicalSchool" || opt === "flightSchool")) {
    awardBrownie(ch, 1, `Graduated from ${opt}`);
  }
  if (r.honors) {
    awardBrownie(ch, 1, `Honors graduate of ${opt}`);
  }
}
