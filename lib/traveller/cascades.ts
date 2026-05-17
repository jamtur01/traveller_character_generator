// Cascade-skill resolution. All cascade pools live in the edition JSON
// under `cascadeSkills`; this module exposes thin helpers that look them
// up via the edition-aware cascadeMap and pick a specific weapon/vehicle,
// preferring one the character already has so subsequent occurrences
// stack into a single skill.

import { arnd } from "./random";
import type { Character } from "./character";
import { cascadePoolByKey } from "./engine/cascadeMap";

/** CT cascade pools, sourced from `ct-classic.json` cascadeSkills. Tests
 *  and the PDF renderer use these as the CT-default pool references.
 *  For edition-aware lookup at runtime, use cascadePoolByKey or the
 *  cascade* helpers below — they read from the character's edition. */
const CT = "ct-classic";
export const BLADES = cascadePoolByKey("bladeCombat", CT);
export const BOWS = cascadePoolByKey("bowCombat", CT);
export const GUNS = cascadePoolByKey("gunCombat", CT);
export const VEHICLES = cascadePoolByKey("vehicle", CT);
export const AIRCRAFTS = cascadePoolByKey("aircraft", CT);
export const WATERCRAFTS = cascadePoolByKey("watercraft", CT);

function pickKnownOrRandom(known: string[], pool: readonly string[]): string {
  return known.length > 0 ? arnd(known) : arnd(pool);
}

function knownFrom(ch: Character, pool: readonly string[]): string[] {
  const out: string[] = [];
  for (const [name] of ch.skills) {
    if ((pool as readonly string[]).includes(name)) out.push(name);
  }
  return out;
}

function cascadeBy(ch: Character, key: string): string {
  const pool = cascadePoolByKey(key, ch.editionId);
  return pickKnownOrRandom(knownFrom(ch, pool), pool);
}

export function cascadeBlade(ch: Character): string {
  return cascadeBy(ch, "bladeCombat");
}
export function cascadeBow(ch: Character): string {
  return cascadeBy(ch, "bowCombat");
}
export function cascadeGun(ch: Character): string {
  return cascadeBy(ch, "gunCombat");
}
export function cascadeVehicle(ch: Character): string {
  return cascadeBy(ch, "vehicle");
}
export function cascadeAircraft(ch: Character): string {
  return cascadeBy(ch, "aircraft");
}
/** Pick a service aircraft at enlistment time — no character history to
 *  consult. Reads the requested edition's pool. */
export function cascadeServiceAircraft(editionId: string): string {
  const pool = cascadePoolByKey("aircraft", editionId);
  return arnd(pool);
}
export function cascadeWatercraft(ch: Character): string {
  return cascadeBy(ch, "watercraft");
}
