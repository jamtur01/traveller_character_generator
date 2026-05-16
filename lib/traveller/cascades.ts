// Cascade-skill resolution: when a roll grants "Blade", "Gun", or "Vehicle",
// pick the specific weapon/vehicle, preferring one the character already has
// (so subsequent occurrences stack into a single skill).

import { arnd } from "./random";
import type { Character } from "./character";

export const BLADES = [
  "Dagger", "Foil", "Sword", "Cutlass", "Broadsword", "Bayonet",
  "Spear", "Halberd", "Pike", "Cudgel",
] as const;

export const BOWS = [
  "Sling", "Short Bow", "Long Bow",
  "Sporting Crossbow", "Military Crossbow", "Repeating Crossbow",
] as const;

export const GUNS = [
  "Body Pistol", "Auto Pistol", "Revolver", "Carbine", "Rifle",
  "Auto Rifle", "Shotgun", "SMG", "Laser Carbine", "Laser Rifle",
] as const;

export const VEHICLES = [
  "Prop-driven Fixed Wing", "Jet-driven Fixed Wing", "Helicopter",
  "Grav Vehicle", "Tracked Vehicle", "Wheeled Vehicle",
  "Large Watercraft", "Small Watercraft", "Hovercraft", "Submersible",
] as const;

// TTB p. 25: Aircraft cascade lists only the three fixed-wing/rotary types.
// Grav Vehicle is its own top-level Vehicle choice, not an Aircraft sub-type.
export const AIRCRAFTS = [
  "Prop-driven Fixed Wing", "Jet-driven Fixed Wing", "Helicopter",
] as const;

export const WATERCRAFTS = [
  "Large Watercraft", "Small Watercraft", "Hovercraft", "Submersible",
] as const;

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

export function cascadeBlade(ch: Character): string {
  return pickKnownOrRandom(knownFrom(ch, BLADES), BLADES);
}
export function cascadeBow(ch: Character): string {
  return pickKnownOrRandom(knownFrom(ch, BOWS), BOWS);
}
export function cascadeGun(ch: Character): string {
  return pickKnownOrRandom(knownFrom(ch, GUNS), GUNS);
}
export function cascadeVehicle(ch: Character): string {
  return pickKnownOrRandom(knownFrom(ch, VEHICLES), VEHICLES);
}
export function cascadeAircraft(ch: Character): string {
  return pickKnownOrRandom(knownFrom(ch, AIRCRAFTS), AIRCRAFTS);
}
/** Pick a service aircraft at enlistment time — no character history to consult. */
export function cascadeServiceAircraft(): string {
  return arnd(AIRCRAFTS);
}
export function cascadeWatercraft(ch: Character): string {
  return pickKnownOrRandom(knownFrom(ch, WATERCRAFTS), WATERCRAFTS);
}
