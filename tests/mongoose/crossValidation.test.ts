import { describe, it, expect } from "vitest";
import * as session from "@/lib/traveller/chargen/session";
import type { EnlistOptions } from "@/lib/traveller/chargen/session";
import { getEdition } from "@/lib/traveller/editions";
import type { MongooseEffect } from "@/lib/traveller/engine/mongoose/types";
import type { AttributeKey } from "@/lib/traveller/types";

// Every kind the interpreter (engine/mongoose/effects.ts applyEffect) handles.
const HANDLED = new Set([
  "gainSkill", "gainSkillChoice", "gainAnySkill", "modifyCharacteristic",
  "modifyCharacteristicChoice", "benefitDm", "advancementDm", "survivalDm",
  "qualificationDm", "gainRelation", "rollMishap", "rollInjury", "lifeEvent",
  "autoPromote", "autoCommission", "benefitRoll", "forfeitBenefits", "stayInCareer",
  "leaveCareer", "forceCareer", "offerCareer", "rollDraft", "rollForceCareer",
  "chooseEffect", "check",
]);

function effectKinds(effects: readonly MongooseEffect[]): string[] {
  const out: string[] = [];
  for (const e of effects) {
    out.push(e.kind);
    if (e.kind === "chooseEffect") for (const branch of e.options) out.push(...effectKinds(branch));
    else if (e.kind === "check") out.push(...effectKinds(e.onSuccess), ...effectKinds(e.onFailure));
  }
  return out;
}

const ATTRS: readonly AttributeKey[] = [
  "strength", "dexterity", "endurance", "intelligence", "education", "social",
];

const ENLIST: EnlistOptions = {
  verbose: false, preferredService: "random", acgService: "army", acgCombatArm: "",
  acgFleet: "imperialNavy", acgDivision: "field", acgLineType: "", acgSubsectorTech: "",
  acgMerchantAcademy: false,
};

function generate(seed: number): session.ChargenSnapshot {
  let s = session.startCareer({
    edition: "mongoose-2e", verbose: false, interactiveMode: false,
    supportsInteractive: false, useAcg: false, acgPathway: "", seed,
  });
  s = session.enlist(s, ENLIST);
  for (let i = 0; i < 4 && s.phase === "term"; i++) s = session.runTerm(s);
  if (s.phase === "term") s = session.attemptMusterOut(s);
  if (s.phase === "career") s = session.attemptMusterOut(s);
  return s;
}

describe("mongoose cross-validation: effect-kind coverage", () => {
  const mg = getEdition("mongoose-2e").data.mongoose!;

  it("every effect kind used anywhere in the data is handled by the interpreter", () => {
    const used = new Set<string>();
    const rows = [
      ...Object.values(mg.careers).flatMap((c) => [...c.events, ...c.mishaps]),
      ...mg.lifeEvents,
      ...mg.lifeEventsUnusual,
    ];
    for (const r of rows) for (const k of effectKinds(r.effects)) used.add(k);
    const unhandled = [...used].filter((k) => !HANDLED.has(k));
    expect(unhandled).toEqual([]);
    expect(used.size).toBeGreaterThan(5); // sanity: the data really uses effects
  });
});

describe("mongoose cross-validation: seed sweep", () => {
  const SEEDS = Array.from({ length: 40 }, (_, i) => i * 101 + 7);

  it("every seed generates a valid character without throwing", () => {
    for (const seed of SEEDS) {
      const snap = generate(seed);
      const c = snap.character;
      expect(snap.phase, `seed ${seed} phase`).toBe("end");
      expect(c.mongooseState!.history.length, `seed ${seed} careers`).toBeGreaterThanOrEqual(1);
      for (const k of ATTRS) {
        expect(c.attributes[k], `seed ${seed} ${k}`).toBeGreaterThanOrEqual(0);
        expect(c.attributes[k], `seed ${seed} ${k}`).toBeLessThanOrEqual(15);
      }
      for (const [n, l] of c.skills) {
        expect(l, `seed ${seed} skill ${n}`).toBeGreaterThanOrEqual(0);
        expect(l, `seed ${seed} skill ${n} <= 4`).toBeLessThanOrEqual(4);
      }
      expect(c.age).toBe(18 + c.terms * 4);
    }
  });

  it("is deterministic per seed (event-sourced re-execution)", () => {
    for (const seed of [7, 108, 512, 2026]) {
      const a = generate(seed).character;
      const b = generate(seed).character;
      expect(a.skills, `seed ${seed}`).toEqual(b.skills);
      expect(a.attributes, `seed ${seed}`).toEqual(b.attributes);
      expect(a.mongooseState!.history, `seed ${seed}`).toEqual(b.mongooseState!.history);
      expect(a.credits, `seed ${seed}`).toBe(b.credits);
    }
  });
});
