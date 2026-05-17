// Procedural name generation. Pools live in data/names.json so adding new
// names is a data edit, not a code change.

import namesJson from "../../data/names.json";
import { arnd, roll } from "./random";
import type { Gender } from "./types";

interface NameData {
  femaleNames: string[];
  maleNames: string[];
  familyNames: string[];
}

const POOL = namesJson as NameData;

export function generateName(gender: Gender): string {
  const given = gender === "female" ? POOL.femaleNames : POOL.maleNames;
  return `${arnd(given)} ${arnd(POOL.familyNames)}`;
}

export function generateGender(): Gender {
  return roll(1) <= 2 ? "female" : "male";
}
