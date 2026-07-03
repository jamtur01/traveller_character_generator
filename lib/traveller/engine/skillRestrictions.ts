// Homeworld skill restrictions per MT Players' Manual p. 39.
//
// Two distinct rules:
//   1. Vehicle skills are limited by the character's homeworld tech code.
//      A skill rolled / chosen that exceeds the homeworld's tech ceiling
//      may be attempted via a 2D 7+ override roll; failure forfeits the
//      skill roll entirely.
//   2. Weapon skills are limited by homeworld tech code AND law code.
//      (The PM's legal-weapons-per-law-code table is currently not mapped
//      into JSON — the inverse "what law codes does this weapon need?"
//      mapping requires additional rule clarification. The data block in
//      mt-megatraveller.json leaves weaponSkillTech / weaponSkillMaxLaw
//      empty; the engine reads them when populated.)
//
// Noble service is exempt from all homeworld skill limitations.
//
// Override roll on failure forfeits the skill roll (no skill added,
// no consolation). On success the skill is added normally.

import type { Character } from "@/lib/traveller/character";
import { getEdition } from "@/lib/traveller/editions";
import { event as ev } from "@/lib/traveller/history";

interface RestrictionsData {
  rule?: string;
  source?: string;
  overrideTarget: number;
  exemptServices: string[];
  /** Services whose practitioners may treat the homeworld law code as one
   *  step lower when checking weapon-skill maxLaw (PM p. 39: "Law Enforcers,
   *  Pirates, and Rogues may select weapon skills one law code lower than
   *  their homeworld's law code"). */
  weaponLawLowerServices?: string[];
  vehicleSkillTech: Record<string, string>;
  weaponSkillTech: Record<string, string>;
  weaponSkillMaxLaw: Record<string, string>;
}

function dataFor(ch: Character): {
  r: RestrictionsData;
  techOrder: string[];
  lawOrder: string[];
} | null {
  const ed = getEdition(ch.editionId);
  const rules = (ed.data.rules as {
    homeworldSkillRestrictions?: RestrictionsData;
  } | undefined);
  const hw = ed.data.homeworld;
  if (!rules?.homeworldSkillRestrictions || !hw?.techCodeOrder) return null;
  return {
    r: rules.homeworldSkillRestrictions as RestrictionsData,
    techOrder: hw.techCodeOrder,
    lawOrder: hw.lawOrder ?? [],
  };
}

/** Decide whether a skill is restricted by homeworld and return the
 *  required override roll target, or null when no override is needed. */
export function skillRequiresOverride(
  ch: Character,
  skillName: string,
): number | null {
  const d = dataFor(ch);
  if (!d) return null;
  if (!ch.homeworld) return null;
  if (d.r.exemptServices.includes(String(ch.service))) return null;

  const techOrder = d.techOrder;
  const hwTechIdx = techOrder.indexOf(ch.homeworld.tech);

  const vehicleReq = d.r.vehicleSkillTech[skillName];
  if (vehicleReq !== undefined) {
    const reqIdx = techOrder.indexOf(vehicleReq);
    if (reqIdx > hwTechIdx) return d.r.overrideTarget;
  }

  const weaponTechReq = d.r.weaponSkillTech[skillName];
  if (weaponTechReq !== undefined) {
    const reqIdx = techOrder.indexOf(weaponTechReq);
    if (reqIdx > hwTechIdx) return d.r.overrideTarget;
  }

  const weaponMaxLaw = d.r.weaponSkillMaxLaw[skillName];
  if (weaponMaxLaw !== undefined) {
    const maxIdx = d.lawOrder.indexOf(weaponMaxLaw);
    let hwLawIdx = d.lawOrder.indexOf(ch.homeworld.law);
    // Law Enforcers, Pirates, Rogues effectively see law one step lower
    // for weapon-skill restriction purposes.
    if (d.r.weaponLawLowerServices?.includes(String(ch.service)) && hwLawIdx > 0) {
      hwLawIdx -= 1;
    }
    if (hwLawIdx > maxIdx) return d.r.overrideTarget;
  }

  return null;
}

/** Roll the 2D override for a restricted skill. Returns true on 7+
 *  (skill goes through), false on failure (skill roll forfeited). */
export function rollSkillOverride(
  ch: Character,
  skillName: string,
  target: number,
): boolean {
  const r = ch.rng.roll(2);
  const passed = r >= target;
  ch.log(ev.roll(
    `Homeworld override (${skillName})`, r, 0, target, passed,
    passed ? "skill acquired" : "skill forfeited",
  ));
  return passed;
}

/** Convenience: if the skill is restricted, roll the override and return
 *  whether the skill should be added. If unrestricted, returns true.
 *  The caller should skip addSkill when this returns false. */
export function acquireSkillWithRestrictionCheck(
  ch: Character,
  skillName: string,
): boolean {
  const target = skillRequiresOverride(ch, skillName);
  if (target === null) return true;
  return rollSkillOverride(ch, skillName, target);
}
