import { describe, it, expect, vi, afterEach } from "vitest";
import { Character } from "@/lib/traveller/character";
import type { Attributes } from "@/lib/traveller/types";
import { freshMongooseState } from "@/lib/traveller/engine/mongoose/state";
import { applyEffects } from "@/lib/traveller/engine/mongoose/effects";
import { getMongooseData, mongooseSkillNames, skillBaseName } from "@/lib/traveller/engine/mongoose/core";

const ATTRS: Attributes = {
  strength: 8, dexterity: 7, endurance: 7, intelligence: 7, education: 7, social: 7,
};

// Construction consumes Math.random (gender/name), so tests build the character
// FIRST and mock Math.random AFTER, controlling only the effect's rng.pick draw.
function mongooseChar(): Character {
  const c = new Character({ attributes: ATTRS });
  c.editionId = "mongoose-2e";
  c.choiceMode = "auto";
  c.mongooseState = freshMongooseState();
  c.mongooseState.career = "agent";
  c.mongooseState.assignment = "lawEnforcement";
  return c;
}

describe("gainAnySkill candidate pool", () => {
  afterEach(() => vi.restoreAllMocks());

  it("full catalog: grants a skill that is neither trained nor a background skill", () => {
    const c = mongooseChar();
    const data = getMongooseData(c);
    // The engine's non-existingOnly pool: full catalog reduced to bare (pickable)
    // names — the exact ordered array rng.pick indexes into.
    const pool = [...mongooseSkillNames(c)].filter((n) => skillBaseName(n) === n);
    const target = "Investigate"; // Agent/Scholar catalog skill, not on the p.9 background list

    expect(c.skills).toHaveLength(0);                     // no trained skills
    expect(pool).toContain(target);                      // target IS in the full catalog
    expect(data.backgroundSkills).not.toContain(target); // ...but is not a background skill

    // Rng.pick returns pool[floor(next() * length)]; (idx + 0.5)/length lands on idx.
    const idx = pool.indexOf(target);
    vi.spyOn(Math, "random").mockReturnValue((idx + 0.5) / pool.length);
    applyEffects(c, [{ kind: "gainAnySkill" }]);

    // Teeth: pre-fix the pool was trained + background only, so a purely-catalog
    // skill like Investigate could never be offered, let alone granted.
    expect(c.skills).toEqual([[target, 1]]);
  });

  it("existingOnly: draws only from trained skills, never the wider catalog", () => {
    const c = mongooseChar();
    const data = getMongooseData(c);
    c.addSkill("Gambler", 0); // one trained, non-background skill
    expect(data.backgroundSkills).not.toContain("Gambler");

    vi.spyOn(Math, "random").mockReturnValue(0.5);
    applyEffects(c, [{ kind: "gainAnySkill", existingOnly: true }]);

    // Teeth: the sole candidate is the trained skill, so it is the one raised; a
    // catalog-wide pool would have added some other, untrained skill instead
    // (skills would then hold two entries, not this one).
    expect(c.skills).toEqual([["Gambler", 1]]);
  });

  it("exclude: never grants an excluded skill even when the roll targets it", () => {
    const c = mongooseChar();
    const full = [...mongooseSkillNames(c)].filter((n) => skillBaseName(n) === n);
    const jot = "Jack-of-all-Trades"; // Prisoner event 6 excludes this (Core p.57)
    expect(full).toContain(jot);      // it IS in the catalog...

    // Pin the roll onto the exact slot that selects Jack-of-all-Trades from the
    // unfiltered catalog; with exclusion applied it must resolve to another skill.
    const jotIdx = full.indexOf(jot);
    vi.spyOn(Math, "random").mockReturnValue((jotIdx + 0.5) / full.length);
    applyEffects(c, [{ kind: "gainAnySkill", exclude: [jot], level: 1 }]);

    const granted = c.skills.map(([n]) => n);
    // Teeth: without the exclude filter this pinned roll grants Jack-of-all-Trades.
    expect(granted).toHaveLength(1);     // a skill was still granted
    expect(granted).not.toContain(jot);  // ...but never the excluded one
  });
});
