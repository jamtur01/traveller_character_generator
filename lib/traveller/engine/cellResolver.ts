// Cell-label interpreter. Turns the cell strings printed in the rulebooks
// (e.g., "+1 Intel", "Blade Cbt", "Travellers'", "Mid Psg", "Free Trader")
// into mutations against a Character. Shared by skill-table rolls and
// muster-out benefit rolls.
//
// A cell is one of:
//   - Attribute change: matches /^([+-]\d+)\s+(Stren|Dext|Endur|Intel|Educ|Soc(?:ial)?)$/
//   - Cascade skill:    "Blade Cbt"|"Blade Combat"|"Blade", "Gun Cbt"|..., etc.
//   - Passage:          "High Psg"|"Mid Psg"|"Low Psg"
//   - Weapon (muster):  "Weapon" (random blade-or-gun)
//   - TAS:              "Travellers'"
//   - Ship:             "Free Trader"|"Scout Ship"|"Corsair"|... (consults
//                       benefitDetails for repeat behavior)
//   - Literal skill:    anything else — addSkill(name)
//   - Literal benefit:  "Instruments"|"Watch" — addBenefit(name)
//
// Cells from skillTables (which never contain passages/ships/Weapon) and
// cells from musterOut.benefits both flow through applyCell, with `mode`
// distinguishing the two so we know whether to treat unknown labels as
// skills or benefits.

import type { Character } from "@/lib/traveller/character";
import type { AttributeKey } from "@/lib/traveller/types";
import type { BenefitDetail } from "@/lib/traveller/editions/types";
import { getEdition } from "@/lib/traveller/editions";
import { requireRule, parseDieCount } from "@/lib/traveller/editions/strict";
import { cascadeKeyForLabel, cascadePoolForLabel, isCascadeLabel } from "./cascadeMap";
import { acquireSkillWithRestrictionCheck } from "./skillRestrictions";
import { event as ev } from "@/lib/traveller/history";

/** Map an abbreviated attribute label ("Intel", "Soc") to the engine
 *  attribute key, using the edition's `attributeAbbreviations` JSON. */
function attrKeyFromAbbreviation(editionId: string, abbr: string): AttributeKey | null {
  const v = getEdition(editionId).data.attributeAbbreviations?.[abbr];
  return (v as AttributeKey | undefined) ?? null;
}

// Note: the cascade pool for any given label is now resolved per-edition
// via cascadeMap.cascadePoolForLabel(label, editionId). The edition-aware
// lookup ensures CT's blade pool doesn't leak into MT or vice versa.

/** Look up an abbreviated cell-label passage ("High Psg") in the edition's
 *  benefitDetails.passages and return the display benefit name ("High
 *  Passage") if found. */
function passageDisplayName(editionId: string, label: string): string | null {
  const benefits = getEdition(editionId).data.benefitDetails as
    Record<string, { displayName?: string }> & {
      passages?: Record<string, { displayName?: string }>;
    } | undefined;
  return benefits?.passages?.[label]?.displayName ?? null;
}

/** Is the cell label a ship-benefit name in the edition's benefitDetails? */
function isShipLabel(editionId: string, label: string): boolean {
  const benefits = getEdition(editionId).data.benefitDetails;
  return benefits?.[label]?.shipType !== undefined;
}

/** Canonicalize cells whose printed label differs from the engine's skill
 *  name (typo / abbreviation aliases). Sourced from edition JSON via
 *  `skillLabelRenames`. */
function applySkillLabelRename(editionId: string, label: string): string {
  return getEdition(editionId).data.skillLabelRenames?.[label] ?? label;
}

/** PM Includes-skills are declared in the edition JSON under
 *  `includesSkills`. Receiving an Includes-skill grants every constituent
 *  skill — unlike a cascade, which is one player pick. Entries may be
 *  plain names (granted at level 1) or "Name-N" (granted at level N,
 *  e.g. "Laser Weapons-0" for High-G Environ). */
/** F5: Marine Tradition. When a Marine character receives a Blade Combat
 *  cascade, it must be taken as the forced skill (Large Blade) unless a
 *  saving throw passes. Returns true if the tradition fired and handled
 *  the cell; false if it didn't apply (caller continues normally). */
function tryMarineTradition(
  ch: Character, label: string, source?: string,
): boolean {
  const rule = getEdition(ch.editionId).rules.marineTradition;
  if (!rule || !rule.forcedSkill) return false;
  if (!rule.appliesToServices?.includes(String(ch.service))) return false;
  if (cascadeKeyForLabel(label, ch.editionId) !== rule.appliesToCascade) return false;

  // Saving throw: 2D vs target, with DMs if already skilled in the forced
  // skill at the listed level. The tier skill may be a PM Includes-skill
  // umbrella (e.g., "Large Blade"); check both the literal entry and the
  // expanded constituents (Broadsword/Cutlass/Sword) so a Marine who
  // received the umbrella expansion in a prior term still triggers the DM.
  const target = requireRule(
    rule.savingThrow?.target,
    "rules.marineTradition.savingThrow.target", "PM p. 20 Marine Tradition",
  );
  let dm = 0;
  const tiers = (rule.dmIfAlreadySkillAtLeast ?? []).slice().sort(
    (a, b) => b.level - a.level,
  );
  const skillLevel = (name: string): number => {
    const idx = ch.skills.findIndex(([n]) => n === name);
    return idx >= 0 ? (ch.skills[idx]?.[1] ?? 0) : 0;
  };
  for (const tier of tiers) {
    if (skillLevel(tier.skill) >= tier.level) {
      dm = tier.dm;
      break;
    }
    const expansion = includesExpansion(ch.editionId, tier.skill);
    if (expansion && expansion.length > 0 &&
        expansion.every((inner) => skillLevel(inner.skill) >= tier.level)) {
      dm = tier.dm;
      break;
    }
  }
  // Roll 2D; if it passes, the player escapes the tradition and the
  // normal cascade flow runs.
  const dieCount = parseDieCount(
    requireRule(
      rule.savingThrow?.die,
      "rules.marineTradition.savingThrow.die", "PM p. 20 Marine Tradition",
    ),
    "rules.marineTradition.savingThrow.die",
  );
  const r = ch.rng.roll(dieCount);
  if (r + dm >= target) {
    ch.log(ev.marineTradition("saved", { roll: r, dm, target }));
    return false;
  }
  // Save failed — forced to receive the named skill at level 1. If the
  // forced skill is itself a PM Includes-skill umbrella (e.g., "Large
  // Blade" → Broadsword/Cutlass/Sword), expand all-or-nothing so the
  // Marine gets every constituent weapon (PM doesn't describe a partial
  // expansion state).
  ch.log(ev.marineTradition("forced", {
    forcedSkill: rule.forcedSkill, roll: r, dm, target,
  }));
  const expansion = includesExpansion(ch.editionId, rule.forcedSkill);
  if (expansion) {
    for (const inner of expansion) {
      ch.addSkill(inner.skill, inner.level, source);
    }
  } else {
    ch.addSkill(rule.forcedSkill, 1, source);
  }
  return true;
}

function includesExpansion(
  editionId: string, name: string,
): Array<{ skill: string; level: number }> | null {
  const data = getEdition(editionId).data.includesSkills;
  if (!data) return null;
  const entry = data[name];
  if (!Array.isArray(entry) || entry.length === 0) return null;
  const out: Array<{ skill: string; level: number }> = [];
  for (const item of entry) {
    if (typeof item !== "string") continue;
    const m = item.match(/^(.+)-(\d+)$/);
    if (m) out.push({ skill: m[1]!.trim(), level: parseInt(m[2]!, 10) });
    else out.push({ skill: item, level: 1 });
  }
  return out;
}

export type CellMode = "skill" | "muster";

/** Apply one cell-label string to a character. `source` is recorded on
 *  resulting ev.skillLearned events so the history attributes the grant
 *  to its originating table (basic chargen skill table name) or to
 *  "Muster". */
export function applyCell(
  ch: Character,
  rawLabel: string,
  mode: CellMode,
  benefitDetails?: Record<string, BenefitDetail>,
  source?: string,
): void {
  const label = rawLabel.trim();
  const grantSource = source ?? (mode === "muster" ? "Muster" : undefined);

  // Attribute change ("+1 Intel", "-1 Social", "+2 Stren").
  const m = label.match(/^([+-]\d+)\s+(\w+)$/);
  if (m) {
    const delta = parseInt(m[1]!, 10);
    const attr = attrKeyFromAbbreviation(ch.editionId, m[2]!);
    if (!attr) throw new Error(`Unknown attribute abbr in cell "${label}"`);
    ch.improveAttribute(attr, delta);
    return;
  }

  // F5 Marine Tradition: PM p. 49. When a Marine receives Blade Combat,
  // it must be taken as Large Blade unless they pass a saving throw.
  // Data-driven via rules.marineTradition.
  if (mode === "skill" && tryMarineTradition(ch, label, grantSource)) return;

  // Cascade label — resolve the pool via the character's edition.
  // A label might be a cascade alias in MT (e.g., "Gunnery" cascades to
  // Screens/Spinal/Turret) but a literal skill in CT. Pool existence is
  // the authoritative test: alias + edition has pool = cascade; alias +
  // no pool = fall through to literal skill handling below.
  const pool = isCascadeLabel(label, ch.editionId)
    ? cascadePoolForLabel(label, ch.editionId)
    : undefined;
  if (pool) {
    if (mode === "muster") {
      // Muster cascades follow doWeaponBenefit's add-as-benefit-plus-skill-0
      // semantics on first occurrence; Character helpers manage repeats.
      const cascadeKey = cascadeKeyForLabel(label, ch.editionId);
      if (cascadeKey === "bladeCombat") {
        ch.doBladeBenefit();
        return;
      }
      if (cascadeKey === "gunCombat") {
        ch.doGunBenefit();
        return;
      }
    }
    const known: string[] = [];
    for (const [n] of ch.skills) if (pool.includes(n)) known.push(n);
    ch.pickOrDefer({
      kind: "cascade",
      label: `Choose a ${label}`,
      options: pool,
      preferred: known,
      context: { source: mode === "muster" ? "muster" : "skillTable", cellLabel: label },
      onResolve: (ch, name) => {
        // Homeworld limitation: tech/law-restricted cascade picks (vehicles,
        // weapons) require a 2D 7+ override per PM p. 39. On failure the
        // skill roll is forfeited entirely.
        if (mode !== "muster" && !acquireSkillWithRestrictionCheck(ch, name)) return;
        ch.log(ev.cascadePick(label, name));
        // PM Includes-skills: picking an umbrella name (Axe, Large Blade,
        // Polearm, Handgun, Combat Rifleman, ATV, Heavy Weapons, etc.)
        // grants every constituent skill at the listed level. The
        // restriction check fires ONCE for the umbrella (above); the
        // expansion is all-or-nothing — PM doesn't describe a partial-
        // expansion state where a character ends up with some but not
        // all constituents.
        const expansion = includesExpansion(ch.editionId, name);
        if (expansion && mode !== "muster") {
          for (const inner of expansion) {
            ch.addSkill(inner.skill, inner.level, grantSource);
          }
          return;
        }
        ch.addSkill(name, 1, grantSource);
      },
    });
    return;
  }

  // Muster-specific cells.
  if (mode === "muster") {
    if (label === "Weapon") {
      ch.doWeaponBenefit();
      return;
    }
    if (label === "Travellers'") {
      const detail = benefitDetails?.["Travellers'"];
      const name = detail?.displayName;
      if (!name) {
        throw new Error(
          `Edition "${ch.editionId}" benefitDetails.Travellers' is missing displayName.`,
        );
      }
      if (detail?.repeat === "no effect" && ch.benefits.indexOf(name) > -1) {
        ch.log(ev.noEffect(`repeat ${label} (non-stackable)`));
        return;
      }
      ch.addBenefit(name);
      ch.TAS = true;
      return;
    }
    const passage = passageDisplayName(ch.editionId, label);
    if (passage) {
      ch.addBenefit(passage);
      return;
    }
    if (isShipLabel(ch.editionId, label)) {
      applyShipBenefit(ch, label, benefitDetails);
      return;
    }
    // Plain benefit string (Instruments, Watch). Non-stackable behavior is
    // driven by benefitDetails.<label>.repeat === "no effect" (B11).
    const detail = benefitDetails?.[label];
    if (detail?.repeat === "no effect") {
      if (ch.benefits.indexOf(label) > -1) {
        ch.log(ev.noEffect(`repeat ${label} (non-stackable)`));
        return;
      }
      ch.addBenefit(label);
      return;
    }
    // Fallthrough — treat as a literal benefit add.
    ch.addBenefit(label);
    return;
  }

  // Skill-table mode: literal skill name (with edition-specific renames
  // applied, e.g. "Electronics" → "Electronic").
  const skillName = applySkillLabelRename(ch.editionId, label);
  // F1: PM Includes-skills expand to all constituent skills at level 1
  // each (e.g., ATV → Tracked Vehicle + Wheeled Vehicle; Handgun → Body
  // Pistol, Pistol, Revolver, Snub Pistol). Data lives in the edition's
  // `includesSkills` block. The restriction check fires once for the
  // umbrella (below); the expansion is all-or-nothing.
  const expansion = includesExpansion(ch.editionId, skillName);
  if (expansion) {
    if (!acquireSkillWithRestrictionCheck(ch, skillName)) return;
    for (const inner of expansion) {
      ch.addSkill(inner.skill, inner.level, grantSource);
    }
    return;
  }
  // Homeworld limitation: literal vehicle/weapon cells (e.g., "Grav Belt")
  // also gate through the override roll. Non-restricted skills pass through.
  if (!acquireSkillWithRestrictionCheck(ch, skillName)) return;
  ch.addSkill(skillName, 1, grantSource);
}

function applyShipBenefit(
  ch: Character,
  label: string,
  benefitDetails?: Record<string, BenefitDetail>,
): void {
  const already = ch.benefits.indexOf(label) > -1;
  const detail = benefitDetails?.[label];

  // Mortgaged ship benefit (Free Trader, Seeker, Yacht, Lab Ship, Safari
  // Ship): repeat receipts pay down the mortgage by repeatReducesMortgageYears
  // years (PM p. 17: "non-Scout/Corsair ships follow the 40-year/10-year
  // repeat rule"). Scout Ship and Corsair use ownership semantics that
  // ignore mortgage entirely — they fall through to the no-mortgage path.
  if (already && detail?.repeatReducesMortgageYears) {
    if (ch.mortgage > 0) {
      const paid = Math.min(ch.mortgage, detail.repeatReducesMortgageYears);
      ch.mortgage -= paid;
      ch.log(ev.mortgagePayoff(label, paid));
    } else {
      ch.log(ev.noEffect(`repeat ${label} but mortgage already paid`));
    }
    return;
  }

  if (already) {
    ch.log(ev.noEffect(`repeat ${label} (already owned)`));
    return;
  }
  ch.addBenefit(label);
  ch.ship = true;
  // First receipt: the initial mortgage is sourced from JSON. Mortgaged ships
  // (e.g. Free Trader) declare firstReceiptMortgageYears; owned ships
  // (Scout Ship/Corsair) omit it and carry no mortgage.
  ch.mortgage = detail?.firstReceiptMortgageYears ?? 0;
}
