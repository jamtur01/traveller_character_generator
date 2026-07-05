// Shared read helpers for the Mongoose 2e engine: strict data access and the
// characteristic-DM lookup used by every career check. Pure over the edition
// JSON (data.mongoose) — no game constants baked here.

import type { Character } from "@/lib/traveller/character";
import type { AttributeKey } from "@/lib/traveller/types";
import { getEdition } from "@/lib/traveller/editions";
import { requireRule } from "@/lib/traveller/editions/strict";
import { characteristicDm } from "@/lib/traveller/core";
import type { MongooseData, MongooseCareer, MongooseCheck } from "@/lib/traveller/engine/mongoose/types";

/** The edition's mongoose data block (throws if the edition lacks one). */
export function getMongooseData(ch: Character): MongooseData {
  return requireRule(
    getEdition(ch.editionId).data.mongoose, "mongoose", "MgT2 Core p.8",
  );
}

/** A career by id (throws with a citation path if absent). */
export function getCareer(ch: Character, id: string): MongooseCareer {
  return requireRule(
    getMongooseData(ch).careers[id],
    `mongoose.careers.${id}`, "MgT2 Core pp.22-45",
  );
}

/** The dice modifier a check contributes: the best characteristic DM among its
 *  characteristics (Mongoose "X or Y" takes the higher). An empty list (the
 *  Drifter automatic qualification) contributes 0. */
export function checkDm(ch: Character, check: MongooseCheck): number {
  if (check.characteristics.length === 0) return 0;
  const bands = getMongooseData(ch).characteristicDmBands;
  return Math.max(
    ...check.characteristics.map((k) =>
      characteristicDm(ch.attributes[k as AttributeKey], bands),
    ),
  );
}
