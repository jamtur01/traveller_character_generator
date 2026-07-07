import { describe, it, expect, vi, afterEach } from "vitest";
import { Character } from "@/lib/traveller/character";
import type { Attributes } from "@/lib/traveller/types";
import { freshMongooseState } from "@/lib/traveller/engine/mongoose/state";
import { rollAging, agingBegun } from "@/lib/traveller/engine/mongoose/aging";
import { musterOut } from "@/lib/traveller/engine/mongoose/muster";

const d6 = (v: number) => (v - 1) / 6 + 0.001;

function mchar(over: Partial<Attributes> = {}): Character {
  const c = new Character({
    attributes: {
      strength: 7, dexterity: 7, endurance: 7,
      intelligence: 7, education: 7, social: 7, ...over,
    },
  });
  c.editionId = "mongoose-2e";
  c.choiceMode = "auto";
  c.mongooseState = freshMongooseState();
  c.mongooseState.career = "agent";
  c.mongooseState.assignment = "lawEnforcement";
  return c;
}

describe("ageing", () => {
  afterEach(() => vi.restoreAllMocks());

  it("begins only at the ageing start term (Core p.49: term 4)", () => {
    const c = mchar();
    c.terms = 3;
    expect(agingBegun(c)).toBe(false);
    c.terms = 4;
    expect(agingBegun(c)).toBe(true);
  });

  it("applies the reductions for the modified roll (highest scores first)", () => {
    const c = mchar();
    c.terms = 5; // DM -5
    const seq = [d6(1), d6(1)]; // 2D = 2 -> 2 - 5 = -3 (one phys -2, two phys -1)
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? d6(3));
    rollAging(c);
    expect(c.attributes.strength).toBe(5); // highest -> -2
    expect(c.attributes.dexterity).toBe(6);
    expect(c.attributes.endurance).toBe(6);
  });

  it("survives an ageing crisis by restoring a zeroed characteristic to 1", () => {
    const c = mchar({ strength: 2, dexterity: 2, endurance: 2 });
    c.terms = 8; // DM -8
    const seq = [d6(1), d6(1)]; // 2D = 2 -> -6 (three phys -2, one mental -1)
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++] ?? d6(3));
    rollAging(c);
    expect(c.attributes.strength).toBe(1); // 2 - 2 = 0 -> crisis restores to 1
    expect(c.events.some((e) => e.kind === "raw" && /Characteristic crisis/.test(e.text))).toBe(true);
  });
});

describe("musterOut", () => {
  afterEach(() => vi.restoreAllMocks());

  it("records the career, bumps the previous-career count, and rolls benefits", () => {
    const c = mchar();
    c.mongooseState!.termsInCareer = 2;
    c.mongooseState!.rank = 1; // benefits-of-rank band 1-2 -> +1 roll
    musterOut(c);
    expect(c.mongooseState!.careerCount).toBe(1);
    expect(c.mongooseState!.history).toHaveLength(1);
    expect(c.mongooseState!.history[0]).toMatchObject({ career: "agent", terms: 2, finalRank: 1 });
    expect(c.mongooseState!.cashRollsUsed).toBeLessThanOrEqual(3);
    expect(c.events.some((e) => e.kind === "section" && /Mustering out/.test(e.label))).toBe(true);
  });

  it("grants a pension after 5+ terms in a non-excluded career (Core p.49)", () => {
    const c = mchar();
    c.mongooseState!.termsInCareer = 5;
    musterOut(c);
    expect(c.benefits.some((b) => /Pension Cr10000/.test(b))).toBe(true);
  });

  it("grants no pension in an excluded career (Scout)", () => {
    const c = mchar();
    c.mongooseState!.career = "scout";
    c.mongooseState!.assignment = "courier";
    c.mongooseState!.termsInCareer = 6;
    musterOut(c);
    expect(c.benefits.some((b) => /Pension/.test(b))).toBe(false);
  });
});
