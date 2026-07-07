// Mongoose 2e Ageing (Core pp.48-49): at the end of the fourth term and every
// term thereafter, roll 2D minus total terms on the Ageing table and apply the
// characteristic reductions. A characteristic reduced to 0 triggers an ageing
// crisis; in auto mode we assume emergency medical care restores it to 1.

import type { Character } from "@/lib/traveller/character";
import type { AttributeKey } from "@/lib/traveller/types";
import { event as ev } from "@/lib/traveller/history";
import { requireRule } from "@/lib/traveller/editions/strict";
import { getMongooseData } from "@/lib/traveller/engine/mongoose/core";
import { applyReductions } from "@/lib/traveller/engine/mongoose/effects";

const ALL_ATTRS: readonly AttributeKey[] = [
  "strength", "dexterity", "endurance", "intelligence", "education", "social",
];

/** Whether ageing rolls have begun (end of agingStartTerm onward, Core p.48). */
export function agingBegun(ch: Character): boolean {
  return ch.terms >= getMongooseData(ch).agingStartTerm;
}

/** Roll on the Ageing table for the current term (Core p.49). */
export function rollAging(ch: Character): void {
  const data = getMongooseData(ch);
  const dm = ch.terms * data.agingDmPerTerm;
  const roll = ch.rng.roll(2);
  const thresholds = data.aging.map((r) => r.threshold);
  const value = Math.max(Math.min(...thresholds), Math.min(Math.max(...thresholds), roll + dm));
  const row = requireRule(
    data.aging.find((r) => r.threshold === value), `mongoose.aging[${value}]`, "MgT2 Core p.49",
  );
  ch.log(ev.raw(`Ageing (2D ${roll} - ${ch.terms} terms = ${roll + dm}): ${row.text}`));
  applyReductions(ch, row.reductions);
  // The crisis floor (<= 0) and its restore target are an auto-mode $soloPolicy
  // (NOT a printed value): Core p.49 leaves a 0-characteristic Traveller to
  // medical care / anagathics / death (a referee call), so the restore target
  // is sourced from JSON (mongoose.agingCrisisRestore, $soloPolicy-tagged)
  // rather than hardcoded — emergency care restores each crisis characteristic.
  const restore = requireRule(
    data.agingCrisisRestore, "mongoose.agingCrisisRestore", "MgT2 Core p.49 ($soloPolicy)",
  ).value;
  const crisis = ALL_ATTRS.filter((a) => ch.attributes[a] <= 0);
  if (crisis.length > 0) {
    for (const a of crisis) ch.improveAttribute(a, restore - ch.attributes[a]);
    ch.log(ev.raw(`Ageing crisis: ${crisis.join(", ")} restored to ${restore} with emergency medical care.`));
  }
}
