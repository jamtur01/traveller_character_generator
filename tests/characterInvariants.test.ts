// Teeth for the whole-character correctness oracle (tests/_characterInvariants.ts).
//
// PASS: assertCharacterConsistent accepts the finished characters the walkers
// produce — a CT-basic navy character, an MT-ACG character on EACH of the four
// pathways (mercenary, navy, scout, merchantPrince) whose age matches the exact
// startAge + yearsServed + preCareerAgeYears + imprisonmentAgeYears identity, an
// MT-ACG character with a non-zero pre-career age summand, and a Mongoose full
// run — all with no solo divergences.
// THROW: a single illegal mutation on a clone of a good character makes the
// oracle throw an error that NAMES the violated invariant — proven for
// rank-over-cap, attribute-out-of-range, age-vs-terms (classic and the exact
// ACG off-by-one), the ACG navy fleet rank cap, an undeclared decoration, the
// mongoose per-skill cap, and the mongoose characteristic floor.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  assertCharacterConsistent,
  soloPolicyReason,
  type SoloDivergence,
} from "@/tests/_characterInvariants";
import { walkBasic, walkAcg } from "@/tests/_walker";
import { Character, cloneCharacter } from "@/lib/traveller/character";
import type { NavyAcgState } from "@/lib/traveller/engine/acg/state";
import * as session from "@/lib/traveller/chargen/session";
import type { EnlistOptions } from "@/lib/traveller/chargen/session";
import { getEdition } from "@/lib/traveller/editions";

const MONGOOSE_ENLIST: EnlistOptions = {
  verbose: false,
  preferredService: "random",
  acgService: "army",
  acgCombatArm: "",
  acgFleet: "imperialNavy",
  acgDivision: "field",
  acgLineType: "",
  acgSubsectorTech: "",
  acgMerchantAcademy: false,
};

/** Drive a full seeded Mongoose character to the "end" phase. */
function generateMongoose(seed: number): Character {
  const start = session.startCareer({
    edition: "mongoose-2e",
    verbose: false,
    interactiveMode: false,
    supportsInteractive: false,
    useAcg: false,
    acgPathway: "",
    seed,
  });
  let snap = session.enlist(start, MONGOOSE_ENLIST);
  for (let i = 0; i < 3 && snap.phase === "term"; i++) snap = session.runTerm(snap);
  if (snap.phase === "term") snap = session.attemptMusterOut(snap);
  if (snap.phase === "career") snap = session.attemptMusterOut(snap);
  return snap.character;
}

const ACG_PATHWAYS = ["mercenary", "navy", "scout", "merchantPrince"] as const;

let basic: Character;
let acgNavy: Character;
let acgPreCareer: Character;
let mongoose: Character;

beforeAll(() => {
  basic = walkBasic({ edition: "ct-classic", service: "navy" }).character;
  vi.restoreAllMocks();
  acgNavy = walkAcg({ pathway: "navy" }).character;
  vi.restoreAllMocks();
  // College pre-career ages the character (courseYears), populating the
  // preCareerAgeYears summand so the exact-age identity is exercised with a
  // non-zero pre-career term rather than only the skip case.
  acgPreCareer = walkAcg({ pathway: "navy", preCareer: "college" }).character;
  vi.restoreAllMocks();
  mongoose = generateMongoose(9876);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("assertCharacterConsistent accepts valid finished characters", () => {
  it("passes a CT-basic navy character with no solo divergences", () => {
    const div: SoloDivergence[] = [];
    assertCharacterConsistent(basic, div);
    expect(div).toEqual([]);
  });

  it.each(ACG_PATHWAYS)(
    "passes an MT-ACG %s character (exact age) with no solo divergences",
    (pathway) => {
      const ch = walkAcg({ pathway }).character;
      const div: SoloDivergence[] = [];
      assertCharacterConsistent(ch, div);
      expect(div).toEqual([]);
    },
  );

  it("passes an MT-ACG character carrying a non-zero pre-career age summand", () => {
    // Guard that the pre-career walk actually populated preCareerAgeYears: if a
    // future engine change made college age-free this would silently collapse
    // to the skip case and stop proving the pre-career summand is validated.
    expect(acgPreCareer.acgState?.preCareerAgeYears ?? 0).toBeGreaterThan(0);
    const div: SoloDivergence[] = [];
    assertCharacterConsistent(acgPreCareer, div);
    expect(div).toEqual([]);
  });

  it("passes a Mongoose full-run character with no solo divergences", () => {
    const div: SoloDivergence[] = [];
    assertCharacterConsistent(mongoose, div);
    expect(div).toEqual([]);
  });
});

describe("assertCharacterConsistent throws on the invariant each mutation violates", () => {
  it("rank above the service ladder cap → [rank]", () => {
    const bad = cloneCharacter(basic);
    bad.rank = 99;
    expect(() => assertCharacterConsistent(bad)).toThrow(/\[rank\]/);
  });

  it("attribute above the edition cap → [attributeBounds]", () => {
    const bad = cloneCharacter(basic);
    bad.attributes.strength = 16;
    expect(() => assertCharacterConsistent(bad)).toThrow(/\[attributeBounds\]/);
  });

  it("age inconsistent with terms served → [age]", () => {
    const bad = cloneCharacter(basic);
    bad.age = basic.age + 5;
    expect(() => assertCharacterConsistent(bad)).toThrow(/\[age\]/);
  });

  it("ACG age one year above the exact identity → [age]", () => {
    // The tightened ACG check is exact, not a lower bound: age+1 stays ABOVE
    // the old bound (startAge + yearsServed) yet must now be rejected.
    const bad = cloneCharacter(acgNavy);
    bad.age = acgNavy.age + 1;
    expect(() => assertCharacterConsistent(bad)).toThrow(/\[age\]/);
  });

  it("ACG age off by one with a non-zero pre-career summand → [age]", () => {
    const bad = cloneCharacter(acgPreCareer);
    bad.age = acgPreCareer.age + 1;
    expect(() => assertCharacterConsistent(bad)).toThrow(/\[age\]/);
  });

  it("ACG navy officer rank above the fleet rankCap → [rankCap]", () => {
    const bad = cloneCharacter(acgNavy);
    const nav = bad.acgState as NavyAcgState;
    nav.fleet = "systemSquadron"; // rankCaps.systemSquadron = 7 (< 8)
    nav.isOfficer = true;
    nav.rankCode = "O8";
    expect(() => assertCharacterConsistent(bad)).toThrow(/\[rankCap\]/);
  });

  it("ACG decoration that is not a declared award → [decoration]", () => {
    const bad = cloneCharacter(acgNavy);
    bad.acgState!.decorations.push("Fabricated Medal of Nowhere");
    expect(() => assertCharacterConsistent(bad)).toThrow(/\[decoration\]/);
  });

  it("mongoose skill above skillLevelMax → [skillLevelCap]", () => {
    const bad = cloneCharacter(mongoose);
    bad.skills[0]![1] = 5; // skillLevelMax = 4
    expect(() => assertCharacterConsistent(bad)).toThrow(/\[skillLevelCap\]/);
  });

  it("mongoose characteristic reduced to 0 → [mongooseCharacteristicFloor]", () => {
    const bad = cloneCharacter(mongoose);
    bad.attributes.endurance = 0; // within attributeCaps (min 0) but below the live floor
    expect(() => assertCharacterConsistent(bad)).toThrow(/\[mongooseCharacteristicFloor\]/);
  });
});

describe("soloPolicyReason recognizes the $soloPolicy annotation", () => {
  it("returns the reason string for a tagged value", () => {
    expect(soloPolicyReason({ $soloPolicy: "Core p.49 leaves it unspecified", value: 1 }))
      .toBe("Core p.49 leaves it unspecified");
  });

  it("returns null for an untagged value or a non-object", () => {
    expect(soloPolicyReason({ value: 1 })).toBeNull();
    expect(soloPolicyReason(1)).toBeNull();
    expect(soloPolicyReason(null)).toBeNull();
    expect(soloPolicyReason(undefined)).toBeNull();
  });
});

describe("$soloPolicy audit — non-printed mongoose heuristics carry cited tags", () => {
  // Every engine choice the MgT2 rulebook leaves unspecified is externalized to
  // JSON with a sibling $soloPolicy key whose prose cites the book page. This
  // audit reddens if any of the four is pulled back into code or loses its
  // citation. agingCrisisRestore / reductionPolicy are also read by the engine
  // via requireRule (their `value`); connections / ship-shares are doc-only.
  const mongoose = getEdition("mongoose-2e").data.mongoose;
  if (!mongoose) throw new Error("mongoose-2e edition is missing its mongoose block");
  const block = mongoose as unknown as Record<string, unknown>;

  it.each([
    "agingCrisisRestore",
    "reductionPolicy",
    "connectionsPolicy",
    "shipSharesPolicy",
  ])("mongoose.%s is $soloPolicy-tagged and cites a book page", (key) => {
    const reason = soloPolicyReason(block[key]);
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/p\.\d+/);
  });

  it("the engine-read heuristics expose their governed `value`", () => {
    expect(mongoose.agingCrisisRestore.value).toBe(1);
    expect(mongoose.reductionPolicy.value).toBe("highestFirst");
  });
});
