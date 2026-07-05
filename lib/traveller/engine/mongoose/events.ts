// Mongoose 2e career Events (Core p.18): after surviving a term the Traveller
// rolls 2D on the career's Events table. The row's effects run through the
// shared interpreter (which chains into life events, mishaps, checks, skill
// choices, etc.). An Events result of 7 is a Life Event on every career.

import type { Character } from "@/lib/traveller/character";
import { event as ev } from "@/lib/traveller/history";
import { currentCareer, findRollRow } from "@/lib/traveller/engine/mongoose/core";
import { applyEffects } from "@/lib/traveller/engine/mongoose/effects";

/** Roll a career Event for the current term and apply its effects. */
export function rollEvent(ch: Character): void {
  const { careerId, career } = currentCareer(ch);
  const roll = ch.rng.roll(2);
  const row = findRollRow(
    career.events, roll, `mongoose.careers.${careerId}.events[${roll}]`, "MgT2 Core",
  );
  ch.log(ev.mongooseEvent(roll, row.text));
  applyEffects(ch, row.effects, row.text);
}
