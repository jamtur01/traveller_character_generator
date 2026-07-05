// Procedural name generation. Pools live in data/names.json so adding new
// names is a data edit, not a code change.

import namesJson from "@/data/names.json";
import { Rng } from "./random";
import type { Gender } from "./types";

interface NameData {
  femaleNames: string[];
  maleNames: string[];
  nonbinaryNames: string[];
  familyNames: string[];
}

const POOL = namesJson as NameData;

export function generateName(gender: Gender, rng: Rng): string {
  const given = gender === "female" ? POOL.femaleNames : POOL.maleNames;
  return `${rng.pick(given)} ${rng.pick(POOL.familyNames)}`;
}

export function generateGender(rng: Rng): Gender {
  // No Traveller rule specifies a sex-determination roll (it's player choice
  // and has no mechanical effect), so use an even 50/50 split. One 1D draw
  // keeps the seeded-construction footprint unchanged (gender then name).
  return rng.roll(1) <= 3 ? "female" : "male";
}
