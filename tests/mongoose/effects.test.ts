import { describe, it, expect, vi, afterEach } from "vitest";
import { Character } from "@/lib/traveller/character";
import type { Attributes } from "@/lib/traveller/types";
import { freshMongooseState } from "@/lib/traveller/engine/mongoose/state";
import { applyEffects, rollInjury } from "@/lib/traveller/engine/mongoose/effects";
import type { MongooseEffect } from "@/lib/traveller/engine/mongoose/types";

const d6 = (v: number) => (v - 1) / 6 + 0.001;
const ATTRS: Attributes = {
  strength: 8, dexterity: 7, endurance: 7, intelligence: 7, education: 7, social: 7,
};

function mongooseChar(): Character {
  const c = new Character({ attributes: ATTRS });
  c.editionId = "mongoose-2e";
  c.choiceMode = "auto";
  c.mongooseState = freshMongooseState();
  c.mongooseState.career = "agent";
  c.mongooseState.assignment = "lawEnforcement";
  return c;
}

describe("effect interpreter", () => {
  afterEach(() => vi.restoreAllMocks());

  it("gainRelation adds connections and logs", () => {
    const c = mongooseChar();
    applyEffects(c, [{ kind: "gainRelation", relation: "ally", count: "1" }]);
    expect(c.mongooseState!.connections).toEqual([{ relation: "ally", note: "" }]);
    expect(c.events.some((e) => e.kind === "mongooseConnection")).toBe(true);
  });

  it("threads the granting event/mishap text into the connection note", () => {
    const c = mongooseChar();
    applyEffects(c, [{ kind: "gainRelation", relation: "enemy", count: "1" }], "Test event text");
    expect(c.mongooseState!.connections.at(-1)).toEqual({ relation: "enemy", note: "Test event text" });
  });

  it("benefitRoll adjusts the benefit-roll count (clamped >= 0)", () => {
    const c = mongooseChar();
    applyEffects(c, [{ kind: "benefitRoll", delta: 2 }]);
    expect(c.mongooseState!.benefitRolls).toBe(2);
    applyEffects(c, [{ kind: "benefitRoll", delta: -5 }]);
    expect(c.mongooseState!.benefitRolls).toBe(0);
  });

  it("modifyCharacteristic raises an attribute (respecting caps)", () => {
    const c = mongooseChar();
    applyEffects(c, [{ kind: "modifyCharacteristic", characteristic: "education", delta: 1 }]);
    expect(c.attributes.education).toBe(8);
  });

  it("DM effects accumulate in the pending buckets", () => {
    const c = mongooseChar();
    applyEffects(c, [
      { kind: "advancementDm", dm: 2, scope: "next" },
      { kind: "qualificationDm", dm: 2, scope: "next" },
    ]);
    expect(c.mongooseState!.pendingDms.advancement).toEqual([{ dm: 2, scope: "next" }]);
    expect(c.mongooseState!.pendingDms.qualification).toEqual([{ dm: 2, scope: "next" }]);
  });

  it("stayInCareer sets the no-eject flag", () => {
    const c = mongooseChar();
    applyEffects(c, [{ kind: "stayInCareer" }]);
    expect(c.mongooseState!.perTerm.noEject).toBe(true);
  });

  it("forceCareer records the next-term routing", () => {
    const c = mongooseChar();
    applyEffects(c, [{ kind: "forceCareer", career: "prisoner" }]);
    expect(c.mongooseState!.forcedNextCareer).toBe("prisoner");
  });

  it("chooseEffect applies exactly one branch (auto mode)", () => {
    const c = mongooseChar();
    const eff: MongooseEffect = {
      kind: "chooseEffect",
      options: [[{ kind: "benefitRoll", delta: 1 }], [{ kind: "benefitRoll", delta: 5 }]],
    };
    applyEffects(c, [eff]);
    expect([1, 5]).toContain(c.mongooseState!.benefitRolls);
  });

  it("gainSkillChoice grants one of the options at the listed level", () => {
    const c = mongooseChar();
    applyEffects(c, [{ kind: "gainSkillChoice", options: ["Investigate", "Recon"], level: 1 }]);
    const gained = c.skills.filter(([n, l]) => (n === "Investigate" || n === "Recon") && l === 1);
    expect(gained).toHaveLength(1);
  });

  it("rollInjury reduces the highest physical characteristic", () => {
    const c = mongooseChar(); // STR 8 highest physical
    const seq = [d6(5)]; // Injury 5 = reduce any physical by 1
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? d6(5));
    rollInjury(c, false);
    expect(c.attributes.strength).toBe(7);
    expect(c.events.some((e) => e.kind === "raw" && /Injury \(5\)/.test(e.text))).toBe(true);
  });

  it("restores an injury-zeroed physical characteristic to >= 1 (crisis, Core p.49)", () => {
    // Low physicals so a single injury reduction drives one to <= 0. Injury 3
    // ("Missing Eye or Limb": reduce the higher of STR/DEX by 2) hits STR 2 -> 0.
    // Before the shared crisis restore (02f53cb) the injury path left a live
    // Traveller at 0; only the ageing path restored.
    const c = new Character({ attributes: {
      strength: 2, dexterity: 1, endurance: 7, intelligence: 7, education: 7, social: 7,
    } });
    c.editionId = "mongoose-2e";
    c.choiceMode = "auto";
    c.mongooseState = freshMongooseState();
    c.mongooseState.career = "agent";
    c.mongooseState.assignment = "lawEnforcement";
    const seq = [d6(3)]; // Injury table roll 3 (fixed -2, no further dice)
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? d6(3));
    rollInjury(c, false);
    expect(c.attributes.strength).toBeGreaterThanOrEqual(1);
    expect(
      c.events.some((e) => e.kind === "raw" && /Characteristic crisis/.test(e.text)),
    ).toBe(true);
  });
});
