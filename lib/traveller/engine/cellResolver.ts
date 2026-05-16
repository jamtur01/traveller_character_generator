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

import type { Character } from "../character";
import {
  AIRCRAFTS, BLADES, BOWS, GUNS, VEHICLES, WATERCRAFTS,
} from "../cascades";
import type { AttributeKey } from "../types";
import type { BenefitDetail } from "../editions/types";

const ATTR_BY_ABBR: Record<string, AttributeKey> = {
  Stren: "strength",
  Dext: "dexterity",
  Endur: "endurance",
  Intel: "intelligence",
  Educ: "education",
  Social: "social",
  Soc: "social",
};

const PASSAGES: Record<string, string> = {
  "High Psg": "High Passage",
  "Mid Psg": "Mid Passage",
  "Low Psg": "Low Passage",
};

const SHIPS = new Set([
  "Corsair", "Seeker", "Yacht", "Lab Ship", "Safari Ship",
  "Scout Ship", "Free Trader",
]);

const CASCADE_POOL_BY_LABEL: Record<string, readonly string[]> = {
  "Blade Cbt": BLADES,
  "Blade Combat": BLADES,
  "Blade": BLADES,
  "Gun Cbt": GUNS,
  "Gun Combat": GUNS,
  "Gun": GUNS,
  "Bow Cbt": BOWS,
  "Bow Combat": BOWS,
  "Bow": BOWS,
  "Vehicle": VEHICLES,
  "Air Craft": AIRCRAFTS,
  "Aircraft": AIRCRAFTS,
  "Water Craft": WATERCRAFTS,
  "Watercraft": WATERCRAFTS,
};

/** Canonicalize cells whose printed label differs from the engine's skill name. */
const SKILL_LABEL_RENAMES: Record<string, string> = {
  Engnrng: "Engineering",
  Electronics: "Electronic",
  "Fwd Obsv": "Fwd Obsvr",
};

export type CellMode = "skill" | "muster";

/** Apply one cell-label string to a character. */
export function applyCell(
  ch: Character,
  rawLabel: string,
  mode: CellMode,
  benefitDetails?: Record<string, BenefitDetail>,
): void {
  const label = rawLabel.trim();

  // Attribute change ("+1 Intel", "-1 Social", "+2 Stren").
  const m = label.match(/^([+-]\d+)\s+(\w+)$/);
  if (m) {
    const delta = parseInt(m[1]!, 10);
    const attr = ATTR_BY_ABBR[m[2]!];
    if (!attr) throw new Error(`Unknown attribute abbr in cell "${label}"`);
    ch.improveAttribute(attr, delta);
    return;
  }

  // Cascade skill — pick a specific weapon/vehicle from the pool.
  const pool = CASCADE_POOL_BY_LABEL[label];
  if (pool) {
    if (mode === "muster") {
      // Muster cascades follow doWeaponBenefit's add-as-benefit-plus-skill-0
      // semantics on first occurrence; Character helpers manage repeats.
      if (label === "Blade Cbt" || label === "Blade Combat" || label === "Blade") {
        ch.doBladeBenefit();
        return;
      }
      if (label === "Gun Cbt" || label === "Gun Combat" || label === "Gun") {
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
      onResolve: (c, name) => c.addSkill(name),
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
      if (ch.benefits.indexOf("Travellers' Aid Society") > -1) return;
      ch.addBenefit("Travellers' Aid Society");
      ch.TAS = true;
      return;
    }
    const passage = PASSAGES[label];
    if (passage) {
      ch.addBenefit(passage);
      return;
    }
    if (SHIPS.has(label)) {
      applyShipBenefit(ch, label, benefitDetails);
      return;
    }
    // Plain benefit string (Instruments, Watch).
    const detail = benefitDetails?.[label];
    if (detail?.repeat === "no effect" || label === "Watch" || label === "Instruments") {
      if (ch.benefits.indexOf(label) > -1) {
        ch.debugHistory("No benefit");
        return;
      }
      ch.addBenefit(label);
      return;
    }
    // Fallthrough — treat as a literal benefit add.
    ch.addBenefit(label);
    return;
  }

  // Skill-table mode: literal skill name (with renames applied).
  const skillName = SKILL_LABEL_RENAMES[label] ?? label;
  ch.addSkill(skillName);
}

function applyShipBenefit(
  ch: Character,
  label: string,
  benefitDetails?: Record<string, BenefitDetail>,
): void {
  const already = ch.benefits.indexOf(label) > -1;
  const detail = benefitDetails?.[label];

  // Free Trader: repeat receipts pay down the mortgage by a fixed number of
  // years (encoded in benefitDetails.repeatReducesMortgageYears).
  if (label === "Free Trader" && already && detail?.repeatReducesMortgageYears) {
    ch.mortgages += 1;
    if (ch.mortgage > 0) {
      ch.mortgage -= detail.repeatReducesMortgageYears;
      ch.verboseHistory(
        `${detail.repeatReducesMortgageYears} years of mortgage paid off`,
      );
    } else {
      ch.debugHistory("No benefit");
    }
    return;
  }

  if (already) {
    ch.debugHistory("No benefit");
    return;
  }
  ch.addBenefit(label);
  ch.ship = true;
}
