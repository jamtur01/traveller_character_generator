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

import type { Character } from "@/lib/traveller/character";
import { getEdition } from "@/lib/traveller/editions";
import type { Rng } from "@/lib/traveller/random";
import { awardBrownie, bpAwardFor } from "./awards";
import { event as ev } from "@/lib/traveller/history";
import type { AcgPathwayId } from "./state";
import { rollDieRow } from "@/lib/traveller/engine/acg/pathways/shared";
import { requireRule } from "@/lib/traveller/editions/strict";

export type PreCareerOption =
  | "college" | "navalAcademy" | "militaryAcademy" | "merchantAcademy"
  | "medicalSchool" | "flightSchool";

/** Display label for a pre-career option key. Reads `displayName` from
 *  the edition's preCareerOptions JSON. The label is data, not code; if
 *  an edition declares the option without a displayName that's a data
 *  bug — surface it loudly rather than hiding behind a hardcoded
 *  fallback that drifts out of sync with the JSON. */
/** Map a preCareer option to its event key in common.browniePoints.awards.
 *  Service academies share a single "Service Academy" row in JSON. */
function bpEventKeyFor(opt: PreCareerOption): string {
  switch (opt) {
    case "college": return "Graduation from College";
    case "navalAcademy":
    case "militaryAcademy":
    case "merchantAcademy": return "Service Academy";
    case "medicalSchool": return "Medical School";
    case "flightSchool": return "Flight School";
    default: return "";
  }
}

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

type AutoEnlistSpec = { branch: PreCareerResult["branch"]; pathway: AcgPathwayId };
interface ThrowSpec {
  target: number;
  dms: Array<{ attribute: string; min: number; dm: number }>;
  autoEnlist?: AutoEnlistSpec;
  /** NOTC: rank granted with the commission (PM p. 44/47). */
  commissionRank?: string;
}
interface EducationSpec {
  roll: string;
  dms: Array<{ attribute: string; min: number; dm: number }>;
}
interface HonorsSpec extends ThrowSpec {
  benefit?: string;
  educationFloor?: number;
  educationBump?: number;
}
interface OtcSpec {
  target: number;
  dms: Array<{ attribute: string; min: number; dm: number }>;
  autoEnlist?: { pathway: AcgPathwayId; branchOptions: string[] };
  /** Rank granted with the commission (PM p. 44/47). */
  commissionRank?: string;
}
/** A pre-career admission/attendance gate (Flight School). Each populated
 *  list names prior schools that satisfy the gate under a given condition;
 *  the gate passes if ANY clause matches. */
interface PreCareerGateSpec {
  /** Honors graduate of one of these schools AND currently commissioned. */
  honorsWithCommission?: string[];
  /** Honors graduate of one of these schools (commission irrelevant). */
  honorsAny?: string[];
  /** Graduate (honors or not) of one of these schools. */
  gradAny?: string[];
  /** Graduate of one of these schools AND currently commissioned. */
  gradWithCommission?: string[];
}
/** One selectable service for a Medical School direct commission. */
interface MedicalCommissionBranch {
  label: string;
  branch: PreCareerResult["branch"];
  pathway: AcgPathwayId;
}
interface PreCareerSpec {
  displayName?: string;
  uiSummary?: string;
  eligibility?: { attribute: string; min: number };
  admission?: ThrowSpec;
  success?: ThrowSpec;
  otc?: OtcSpec;
  notc?: ThrowSpec;
  education?: EducationSpec;
  honors?: HonorsSpec;
  /** Medical School: prior honors graduations that qualify entry (B5). */
  honorsPrereq?: string[];
  /** Flight School: gate for who may attend at all (B5). */
  admissionPrereq?: PreCareerGateSpec;
  /** Flight School: gate for automatic admission without a roll (B5). */
  autoAdmit?: PreCareerGateSpec;
  /** Merchant Academy: eligible enlistment line types (B6). */
  requiresLineType?: string[];
  /** Academy/school wash-out draft destination service (B8). */
  washOutDraftedInto?: string;
  /** Medical School: services that accept a direct O3 commission (B7). */
  directCommissionBranches?: MedicalCommissionBranch[];
  [k: string]: unknown;
}

interface PreCareerResult {
  admitted: boolean;
  graduated: boolean;
  honors: boolean;
  commissioned: boolean;
  branch: "army" | "marines" | "navy" | "merchants" | null;
  /** Rank granted by graduation (PM p. 47: academies/OTC/NOTC grant O1;
   *  Medical School graduates may take an automatic direct commission at
   *  O3). Declared per option in JSON (commissionRank). */
  commissionRank?: string;
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

/** Honors gates for Medical / Flight School (PM p. 47), read from the
 *  edition JSON. Medical School requires an honors graduation from one of
 *  medicalSchool.honorsPrereq; Flight School attendance is gated by
 *  flightSchool.admissionPrereq. */
function honorsPrereqMet(ch: Character, opt: PreCareerOption): boolean {
  const spec = specFor(ch.editionId, opt);
  if (opt === "medicalSchool") {
    const honors = ch.acgState?.honorsGraduations ?? [];
    return (spec?.honorsPrereq ?? []).some((s) => honors.includes(s));
  }
  if (opt === "flightSchool") {
    return evalPreCareerGate(ch, spec?.admissionPrereq);
  }
  return true;
}

/** Evaluate a pre-career gate spec (Flight School admission / auto-admit)
 *  against the character's prior graduations and commission status. Each
 *  populated list contributes an OR clause (PM p. 47 / mt-acg-common §1f). */
function evalPreCareerGate(ch: Character, gate: PreCareerGateSpec | undefined): boolean {
  if (!gate) return false;
  const honors = ch.acgState?.honorsGraduations ?? [];
  const schools = ch.acgState?.schoolsAttended ?? [];
  const commissioned = ch.acgState?.preCareerCommission === true || ch.commissioned;
  const anyOf = (list: string[] | undefined, set: string[]): boolean =>
    (list ?? []).some((s) => set.includes(s));
  if (anyOf(gate.honorsAny, honors)) return true;
  if (anyOf(gate.gradAny, schools)) return true;
  if (commissioned && anyOf(gate.honorsWithCommission, honors)) return true;
  if (commissioned && anyOf(gate.gradWithCommission, schools)) return true;
  return false;
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
    const lineType = ch.acgState?.pathway === "merchantPrince"
      ? (ch.acgState.lineType ?? undefined) : undefined;
    const allowed = (spec.requiresLineType ?? []).includes(lineType ?? "");
    if (!allowed) {
      out.notes.push(
        `Merchant Academy requires enlistment in a Megacorporation or Sector-wide line ` +
        `first; current line is ${lineType ?? "(none)"}.`,
      );
      return out;
    }
  }

  // Attribute eligibility gates per PM p. 47 (Naval Academy Social 8+,
  // Military Academy Social 6+). Thresholds live in JSON
  // (preCareerOptions.<opt>.eligibility) and are read via isPreCareerEligible.
  // Failing the gate is "may not apply" — character isn't aged or drafted,
  // they simply can't enter (different from admission-roll failure).
  if (opt === "navalAcademy" && !isPreCareerEligible(ch, opt)) {
    const min = preCareerEligibility(ch.editionId, opt)?.min;
    out.notes.push(`Naval Academy requires Social Standing ${min}+.`);
    return out;
  }
  if (opt === "militaryAcademy" && !isPreCareerEligible(ch, opt)) {
    const min = preCareerEligibility(ch.editionId, opt)?.min;
    out.notes.push(`Military Academy requires Social Standing ${min}+.`);
    return out;
  }

  // Rrev4: Flight School admission is automatic for commissioned college
  // honors graduates and Naval Academy honors graduates (PM p. 47:
  // "Any commissioned college honors graduate or Naval Academy graduate
  // with honors may attend flight school simply by applying"). Other
  // Naval Academy graduates (without honors) and commissioned Merchant
  // Academy graduates must roll for admission.
  const flightAutoAdmit =
    opt === "flightSchool" && evalPreCareerGate(ch, spec.autoAdmit);

  // Admission.
  if (spec.admission && !flightAutoAdmit) {
    const dm = applyDms(spec.admission.dms, ch);
    const r = ch.rng.roll(2);
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
    const r = ch.rng.roll(2);
    const succeeded = r + dm >= spec.success.target;
    ch.log(ev.roll(
      `${preCareerLabel(opt, ch.editionId)} success`,
      r, dm, spec.success.target, succeeded,
    ));
    if (!succeeded) {
      out.notes.push("Did not complete the course.");
      out.ageGainedYears += requireRule(
        getEdition(ch.editionId).rules.preCareer?.washOutAgeYears,
        "rules.preCareer.washOutAgeYears", "PM p. 44",
      );
      // PM p. 47 success-failure outcomes:
      //   College: age 19, first term short.
      //   Naval Academy: age 19, drafted Navy, short term.
      //   Military Academy: age 19, drafted Army, short term.
      //   Merchant Academy: age 19, drafted Army, short term.
      //   Medical School: age 23, may enlist normally OR short term if academy grad.
      //   Flight School: age (varies), reports for duty in Navy/Marines (short).
      out.firstTermShort = true;
      const drafted = spec.washOutDraftedInto;
      if (drafted === "army" || drafted === "navy" || drafted === "marines") {
        out.draftedInto = drafted;
      }
      return out;
    }
    out.graduated = true;
  } else {
    out.graduated = true;
  }

  // Successful graduates age by the option's course length and may serve a
  // short first term (PM p. 47) — both read from the edition JSON
  // (common.preCareerOptions.<opt>): 4y for college/academies/medical
  // school, 1y + short first term for flight school.
  const pco = getEdition(ch.editionId).data.advancedCharacterGeneration
    ?.common?.preCareerOptions?.[opt] as Record<string, unknown> | undefined;
  out.ageGainedYears += (pco?.courseYears as number | undefined) ?? 0;
  if (pco?.firstTermShort === true) out.firstTermShort = true;

  // OTC / NOTC (college only, voluntary).
  if (opt === "college") {
    if (spec.otc) {
      const dm = applyDms(spec.otc.dms, ch);
      const r = ch.rng.roll(2);
      if (r + dm >= spec.otc.target) {
        out.commissioned = true;
        const rank = requireRule(
          spec.otc.commissionRank, "college.otc.commissionRank", "PM p. 44/47",
        );
        out.commissionRank = rank;
        const auto = requireRule(
          spec.otc.autoEnlist, "college.otc.autoEnlist", "PM p. 47",
        );
        out.autoEnlistPathway = auto.pathway;
        const branchOptions = requireRule(
          auto.branchOptions, "college.otc.autoEnlist.branchOptions", "PM p. 47",
        );
        // PM p. 47 line 2782-2783: an OTC graduate is automatically
        // enlisted in (and commissioned as an officer in) the Army or the
        // Marines. Branch is a player choice; the promotion event is logged
        // AFTER the branch is decided so the log line includes "(Army)" or
        // "(Marines)". Pathway + branch options are read from
        // college.otc.autoEnlist (B13).
        // Auto/default branch mirrors the first JSON-declared option
        // (PM p. 47) — never a code literal.
        const defaultBranchLabel = requireRule(
          branchOptions[0], "college.otc.autoEnlist.branchOptions[0]", "PM p. 47",
        );
        const defaultBranch: "army" | "marines" =
          defaultBranchLabel === "Marines" ? "marines" : "army";
        if (ch.choiceMode === "interactive") {
          ch.pickOrDefer({
            kind: "cascade",
            label: "OTC commission — choose your service branch",
            options: branchOptions,
            preferred: [defaultBranchLabel],
            context: { source: "otcBranch" },
            onResolve: (ch, chosen) => {
              // Inline resolution (decision cursor): all effects live here.
              // Code after pickOrDefer runs only on this resolved path —
              // the frontier path throws and discards `out`, so a default
              // assignment after the call would clobber the pick on re-run.
              out.branch = chosen === "Marines" ? "marines" : "army";
              ch.log(ev.promoted(rank, `OTC (${chosen})`));
              out.notes.push(`OTC commission earned (${chosen}).`);
            },
          });
        } else {
          out.branch = defaultBranch;
          ch.log(ev.promoted(rank, `OTC (${defaultBranchLabel})`));
          out.notes.push(
            `OTC commission earned (${defaultBranchLabel} by default; ` +
            `player may select ${branchOptions.join(" or ")}).`,
          );
        }
      }
    }
    if (!out.commissioned && spec.notc) {
      const dm = applyDms(spec.notc.dms, ch);
      const r = ch.rng.roll(2);
      if (r + dm >= spec.notc.target) {
        out.commissioned = true;
        const rank = requireRule(
          spec.notc.commissionRank, "college.notc.commissionRank", "PM p. 44/47",
        );
        out.commissionRank = rank;
        const auto = requireRule(
          spec.notc.autoEnlist, "college.notc.autoEnlist", "PM p. 47",
        );
        out.branch = requireRule(
          auto.branch, "college.notc.autoEnlist.branch", "PM p. 47",
        );
        out.autoEnlistPathway = auto.pathway;
        out.notes.push("NOTC commission earned (Navy).");
        ch.log(ev.promoted(rank, "NOTC"));
      }
    }
  }

  // Education increase.
  if (spec.education) {
    const dm = applyDms(spec.education.dms, ch);
    // Parse "1D-2" / "1D-3" — die count AND constant offset are both used;
    // an unparseable spec is broken edition data and fails loudly.
    const m = spec.education.roll.match(/^(\d+)D([-+]\d+)?$/);
    if (!m) {
      throw new Error(
        `Cannot parse pre-career education roll ${JSON.stringify(spec.education.roll)} ` +
        `(expected "<n>D" with optional +/-k offset)`,
      );
    }
    const offset = m[2] ? parseInt(m[2], 10) : 0;
    const floor = requireRule(
      getEdition(ch.editionId).rules.preCareer?.educationGainFloor,
      "rules.preCareer.educationGainFloor", "PM p. 44",
    );
    const gain = Math.max(floor, ch.rng.roll(parseInt(m[1]!, 10)) + offset + dm);
    out.attributeChanges.education = (out.attributeChanges.education ?? 0) + gain;
    // Applied by applyPreCareerResult via improveAttribute → ev.attributeChange.
  }

  // Honors throw.
  if (spec.honors) {
    const dm = applyDms(spec.honors.dms, ch);
    const r = ch.rng.roll(2);
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
        const floor = requireRule(
          spec.honors.educationFloor, "college.honors.educationFloor", "PM p. 44",
        );
        const bump = requireRule(
          spec.honors.educationBump, "college.honors.educationBump", "PM p. 44",
        );
        const target = Math.max(floor, ch.attributes.education + bump);
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
  if (
    opt === "militaryAcademy" || opt === "navalAcademy" || opt === "merchantAcademy"
  ) {
    const auto = pco?.autoEnlist as AutoEnlistSpec | undefined;
    if (auto) {
      out.commissioned = true;
      out.branch = auto.branch;
      out.commissionRank = requireRule(
        pco?.commissionRank as string | undefined,
        `${opt}.commissionRank`, "PM p. 47",
      );
      out.autoEnlistPathway = auto.pathway;
    }
  } else if (opt === "medicalSchool" && out.graduated) {
    // PM p. 47 / mt-acg-common §1e: a graduate may take an automatic O3
    // direct commission in one of medicalSchool.directCommissionBranches
    // (Navy Medical Branch, Army, Scouts, or Merchants Purser; Marines are
    // excluded — they have no medical officers). Branch is a player choice;
    // auto mode and the pending-choice default both use the first listed
    // service (Navy). Branch/pathway mapping is data-driven (B7).
    out.commissioned = true;
    out.commissionRank = requireRule(
      pco?.commissionRank as string | undefined,
      "medicalSchool.commissionRank", "PM p. 47",
    );
    out.medicalDirectCommission = true;
    const branches = requireRule(
      pco?.directCommissionBranches as MedicalCommissionBranch[] | undefined,
      "medicalSchool.directCommissionBranches", "PM p. 47",
    );
    const fallback = branches[0];
    if (!fallback) {
      throw new Error(
        "medicalSchool.directCommissionBranches is empty (PM p. 47 names " +
        "Navy/Army/Scouts/Merchants) — fix the edition JSON",
      );
    }
    if (ch.choiceMode === "interactive") {
      ch.pickOrDefer({
        kind: "cascade",
        label: "Medical School direct commission — choose service branch",
        options: branches.map((b) => b.label),
        preferred: [fallback.label],
        context: { source: "medicalCommission" },
        onResolve: (_ch, chosen) => {
          // Inline resolution: set the result fields here (see the OTC
          // prompt above). applyPreCareerResult / doApplyPreCareer apply
          // branch + pathway from `out` — no direct character writes.
          const picked = branches.find((b) => b.label === chosen) ?? fallback;
          out.branch = picked.branch;
          out.autoEnlistPathway = picked.pathway;
        },
      });
    } else {
      out.branch = fallback.branch;
      out.autoEnlistPathway = fallback.pathway;
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
      if (hasDieExpression(skill)) {
        // Dynamic skill spec (e.g. "1D-3 levels of Pilot, minimum 1").
        out.skills.push(parseDynamicSkill(skill, ch.rng));
      } else if (ch.rng.roll(1) >= target) {
        out.skills.push([skill, 1]);
      }
    }
  }

  // Plain skill list with no throw (Flight School: Ship's Boat, Navigation,
  // and a dynamic "1D-3 levels of Pilot, minimum 1").
  if (sk && !Array.isArray(sk) && Array.isArray(sk.skills) && !sk.throw) {
    for (const skill of sk.skills) {
      if (hasDieExpression(skill)) {
        out.skills.push(parseDynamicSkill(skill, ch.rng));
      } else {
        out.skills.push([skill, 1]);
      }
    }
  }
  if (Array.isArray(sk)) {
    for (const skill of sk) {
      if (hasDieExpression(skill)) {
        out.skills.push(parseDynamicSkill(skill, ch.rng));
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
  if (!m) {
    throw new Error(
      `Cannot parse pre-career skill throw ${JSON.stringify(throwStr)} ` +
      `(expected a "<target>+" form, e.g. "4+ on 1D")`,
    );
  }
  return parseInt(m[1]!, 10);
}

/** Detect (without side effect) whether a skill string contains an
 *  embedded die expression like "1D-3". Use this for branching; only
 *  parseDieExpression (which rolls dice) should run when the value is
 *  actually consumed — calling the rolling version twice would waste
 *  RNG and break deterministic test mocks. */
function hasDieExpression(s: string): boolean {
  return /\d+D([-+]\d+)?/.test(s);
}

/** Resolve embedded die expressions in skill strings (e.g. "1D-3"),
 *  rolling the declared die count and returning the resulting numeric
 *  value. Side effect: consumes one roll of the declared count. Returns
 *  null when no die expression is present. */
function parseDieExpression(s: string, rng: Rng): number | null {
  const m = s.match(/(\d+)D([-+]\d+)?/);
  if (!m) return null;
  const offset = m[2] ? parseInt(m[2], 10) : 0;
  return rng.roll(parseInt(m[1]!, 10)) + offset;
}

/** Parse a dynamic skill spec like "1D-3 levels of Pilot, minimum 1". */
function parseDynamicSkill(s: string, rng: Rng): [string, number] {
  const die = parseDieExpression(s, rng) ?? 1;
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
  const departments = dept.columns.filter((col) => col !== "die");
  if (departments.length === 0) return;
  // Skill-attempt parameters from the Academy spec (JSON pco.skills).
  const pco = acg?.common?.preCareerOptions?.merchantAcademy as
    { skills?: { throwTarget?: number; rolls?: number } } | undefined;
  const skillsSpec = pco?.skills;
  const skillsTarget = requireRule(
    skillsSpec?.throwTarget, "merchantAcademy.skills.throwTarget", "PM p. 47",
  );
  const skillsCount = requireRule(
    skillsSpec?.rolls, "merchantAcademy.skills.rolls", "PM p. 47",
  );
  const apply = (choice: string): void => {
    out.notes.push(`Merchant department: ${choice}`);
    // PM p. 47: "may select the department to which he will be assigned"
    // — record the player's pick so the post-enlistment flow doesn't
    // re-roll department assignment.
    if (ch.acgState?.pathway === "merchantPrince") ch.acgState.department = choice;
    for (let i = 0; i < skillsCount; i++) {
      if (ch.rng.roll(1) >= skillsTarget) {
        const row = rollDieRow(ch, dept, { dice: 1, dm: 0 });
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
  apply(ch.rng.pick(departments));
}

/** Apply a pre-career result to the character. Mutates state.
 *  schoolsAttempted is recorded eagerly by Character.doPreCareer before
 *  attemptPreCareer fires, so a ChoicePendingError mid-flight doesn't
 *  leave the picker UI offering the same school again. */
export function applyPreCareerResult(ch: Character, opt: PreCareerOption, r: PreCareerResult): void {
  ch.age += r.ageGainedYears;
  for (const [attr, delta] of Object.entries(r.attributeChanges)) {
    const a = attr as keyof Character["attributes"];
    // Route through improveAttribute so the edition's rules.attributeCaps
    // (max/min/socialMin) apply and the change is logged consistently,
    // rather than a hardcoded 0..15 clamp that bypasses socialMin.
    ch.improveAttribute(a, delta);
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
  // Brownie point awards per the manual. Magnitudes read from JSON
  // (common.browniePoints.awards) via bpAwardFor; the event key here
  // maps each preCareer option to its award row.
  if (r.graduated) {
    const bp = bpAwardFor(ch, bpEventKeyFor(opt));
    if (bp !== null) {
      awardBrownie(ch, bp, `Graduated from ${preCareerLabel(opt, ch.editionId)}`);
    }
  }
  if (r.honors) {
    const bp = bpAwardFor(ch, "Honors");
    if (bp !== null) {
      awardBrownie(ch, bp, `Honors graduate of ${preCareerLabel(opt, ch.editionId)}`);
    }
  }
  // Pre-career commission carries into ACG enlistment: subsequent beginAcg
  // honors this rank by skipping the default E1 reset.
  if (r.commissioned && ch.acgState) {
    ch.acgState.isOfficer = true;
    ch.acgState.rankCode = requireRule(
      r.commissionRank, "preCareerOptions.<option>.commissionRank", "PM p. 47",
    );
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
