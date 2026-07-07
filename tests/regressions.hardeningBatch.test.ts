// Regression locks for the df59be3 "harden required-data reads, schema, and
// skill-table mapping" batch. Each describe names the fix and the fail-loud
// contract it defends: silent no-ops / permissive schemas became loud throws.
//
// Intentionally NOT covered here (documented, not stubbed):
//   * serviceLoader skill-table key-mapping (buildServiceDef, tables.indexOf ->
//     meta.order.indexOf): behavior-preserving today because
//     advancedEducation8Plus is last in the declared order, so the old
//     filtered-array index and the new key-mapped index coincide. No input
//     produces a divergent observable result, so no honest red-on-revert test
//     exists — a test would only restate the new implementation.
//   * mongoose model pausedPhase signature (FrontierAction -> +_ch/_base):
//     a type-only change to satisfy the ChargenModel interface. `tsc --noEmit`
//     is the check; there is no runtime behavior to assert.
//   * jsonPhases requireRule sites (scout/merchant skill tables, promote rank
//     ladder): the guarded functions (rollDivisionSkill, rollAvailableTablesSkill,
//     runPromote) are not exported and only reachable mid-ACG-run via a
//     ResolveContext, and reaching a missing table/ladder would require mutating
//     shared getEdition() canon data. Not cleanly testable at the test layer
//     without a source change (exporting internals) or global-state mutation.

import { describe, expect, it, vi, afterEach } from "vitest";
import { Character } from "../lib/traveller/character";
import { getEdition } from "../lib/traveller/editions";
import { buildServiceDef } from "../lib/traveller/engine/serviceLoader";
import { parseCanonData } from "../lib/traveller/editions/schema";
import { freshMongooseState } from "../lib/traveller/engine/mongoose/state";
import { rollSkillTraining } from "../lib/traveller/engine/mongoose/skillsTraining";

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// #2 serviceLoader.applyAutoEntry: an automaticSkills entry with neither
//    "effect" nor "skill" now throws instead of silently granting nothing.
// ---------------------------------------------------------------------------
describe("serviceLoader.applyAutoEntry fails loud on a skill-less/effect-less entry (df59be3)", () => {
  it("throws naming automaticSkills when a rank-triggered entry declares neither effect nor skill", () => {
    const edition = getEdition("ct-classic");
    const navySvc = edition.data.services["navy"];
    if (!navySvc) throw new Error("ct-classic must declare a navy service");
    const navy = structuredClone(navySvc);
    // rank 99 is hit only by our injected entry, so nothing else fires first.
    navy.automaticSkills.push({ trigger: "rank", rank: 99 });
    const def = buildServiceDef(navy, edition);

    const ch = new Character();
    ch.rank = 99;
    expect(() => def.doPromotion(ch)).toThrow(/automaticSkills/);
  });
});

// ---------------------------------------------------------------------------
// #3 schema: ACG rank rows validate as [code, title, ...] arrays. Was
//    z.array(z.unknown()), which accepted a flat ["O1","Captain"] string list.
// ---------------------------------------------------------------------------
describe("schema validates ACG officer rank rows as [code, title, ...] arrays (df59be3)", () => {
  function canon(officer: unknown): unknown {
    return {
      services: {},
      advancedCharacterGeneration: {
        common: {},
        mercenary: { ranks: { officer } },
      },
    };
  }

  it("accepts well-formed nested rank rows", () => {
    expect(() => parseCanonData(canon([["O1", "Captain"]]), "test")).not.toThrow();
  });

  it("rejects a FLAT rank list (strings, not row-arrays)", () => {
    expect(() => parseCanonData(canon(["O1", "Captain"]), "test")).toThrow(/officer/);
  });

  it("rejects rank rows whose code/title are not strings", () => {
    expect(() => parseCanonData(canon([[1, 2]]), "test"))
      .toThrow(/ACG rank row must be \[code, title/);
  });
});

// ---------------------------------------------------------------------------
// #4 mongoose skillsTraining: a non-string cell at a rolled training index
//    now throws instead of silently skipping the skill grant.
// ---------------------------------------------------------------------------
describe("mongoose rollSkillTraining fails loud on a non-string cell at the rolled index (df59be3)", () => {
  function mongooseChar(): Character {
    const c = new Character({
      attributes: {
        strength: 7, dexterity: 7, endurance: 7,
        intelligence: 7, education: 9, social: 7,
      },
    });
    c.editionId = "mongoose-2e";
    // Interactive + a one-entry cursor forces the first table (Personal
    // Development) deterministically; the 1D training roll is mocked below.
    c.choiceMode = "interactive";
    c.decisionCursor = { pos: 0, resolutions: [0] };
    c.mongooseState = freshMongooseState();
    c.mongooseState.career = "agent";
    c.mongooseState.assignment = "lawEnforcement";
    return c;
  }

  it("throws naming the training column when the rolled cell is not a skill", () => {
    const c = mongooseChar();
    // Index 0 is the column's null placeholder (a real 1D roll is 1-6); force
    // the roll onto it to exercise the non-string-cell guard.
    vi.spyOn(c.rng, "roll").mockReturnValue(0);
    expect(() => rollSkillTraining(c))
      .toThrow(/Mongoose training column "Personal Development" has no skill at rolled index/);
  });

  it("still grants a skill on a valid (string) rolled cell", () => {
    const c = mongooseChar();
    vi.spyOn(c.rng, "roll").mockReturnValue(1); // index 1 = a real skill cell
    expect(() => rollSkillTraining(c)).not.toThrow();
    expect(c.events.some((e) =>
      e.kind === "skillLearned" || e.kind === "skillImproved" || e.kind === "attributeChange",
    )).toBe(true);
  });
});
