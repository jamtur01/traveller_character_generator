// Regression lock for 538fb5e: the repeated weapon-benefit "pick a different
// weapon" branch (PM p. 20) now writes ch.bladeBenefit / ch.gunBenefit in the
// nested cascade onResolve. Before the fix the new weapon was added to the
// benefits/skills but the field kept pointing at the ORIGINAL weapon, so a
// later repeat labelled and (in auto mode) bumped the wrong weapon.
//
// The picks are driven through the interactive decision cursor, so the outcome
// is deterministic with no RNG mocking — the cursor resolves each pickOrDefer
// by recorded option index, in prompt order.

import { describe, expect, it } from "vitest";
import { Character } from "../lib/traveller/character";
import { cascadePoolByKey } from "../lib/traveller/engine/cascadeMap";
import { ChoicePendingError } from "../lib/traveller/engine/choices";

// The exact pool pickOrDefer offers (options === this array), so option
// indices below map straight onto it.
const BLADE_POOL = cascadePoolByKey("bladeCombat", "ct-classic");
const ORIGINAL = "Dagger";
const REPLACEMENT = "Sword";
const ORIG_IDX = BLADE_POOL.indexOf(ORIGINAL);
const REPL_IDX = BLADE_POOL.indexOf(REPLACEMENT);
// Repeat-benefit option order: [Bump <current>, Pick a different blade, +1 category].
const PICK_DIFFERENT = 1;

/** Run `fn` through the interactive picker, resolving each pickOrDefer from
 *  `resolutions` (option indices, prompt order). Resets the cursor after. */
function withPicks(c: Character, resolutions: number[], fn: () => void): void {
  c.choiceMode = "interactive";
  c.decisionCursor = { pos: 0, resolutions };
  try {
    fn();
  } finally {
    c.decisionCursor = null;
  }
}

function level(c: Character, name: string): number | undefined {
  return c.skills.find(([n]) => n === name)?.[1];
}

function freshCt(): Character {
  const c = new Character();
  c.showHistory = "none";
  c.bladeBenefit = "";
  c.skills = [];
  return c;
}

describe("repeat weapon benefit — 'pick a different weapon' updates the field (538fb5e)", () => {
  it("both weapons are in the offered cascade pool (index precondition)", () => {
    expect(ORIG_IDX).toBeGreaterThanOrEqual(0);
    expect(REPL_IDX).toBeGreaterThanOrEqual(0);
    expect(ORIG_IDX).not.toBe(REPL_IDX);
  });

  it("sets bladeBenefit to the newly-picked weapon, not the original", () => {
    const c = freshCt();
    withPicks(c, [ORIG_IDX], () => c.doBladeBenefit());
    expect(c.bladeBenefit).toBe(ORIGINAL);

    withPicks(c, [PICK_DIFFERENT, REPL_IDX], () => c.doBladeBenefit());
    // The fix: the nested different-weapon resolve writes ch.bladeBenefit.
    expect(c.bladeBenefit).toBe(REPLACEMENT);
  });

  it("a later auto-mode repeat bumps the newly-picked weapon, not the original", () => {
    const c = freshCt();
    withPicks(c, [ORIG_IDX], () => c.doBladeBenefit());
    withPicks(c, [PICK_DIFFERENT, REPL_IDX], () => c.doBladeBenefit());
    // Both weapons sit at skill-0 after the two cascade picks.
    expect(level(c, ORIGINAL)).toBe(0);
    expect(level(c, REPLACEMENT)).toBe(0);

    // Auto repeat bumps `current` (= ch.bladeBenefit) by 1.
    c.choiceMode = "auto";
    c.doBladeBenefit();

    expect(level(c, REPLACEMENT)).toBe(1); // new weapon received the bump
    expect(level(c, ORIGINAL)).toBe(0);    // original untouched
  });

  it("a later interactive repeat prompt is labelled for the new weapon", () => {
    const c = freshCt();
    withPicks(c, [ORIG_IDX], () => c.doBladeBenefit());
    withPicks(c, [PICK_DIFFERENT, REPL_IDX], () => c.doBladeBenefit());

    // Third repeat, interactive, no recorded picks -> queues the frontier.
    c.choiceMode = "interactive";
    c.decisionCursor = null;
    expect(() => c.doBladeBenefit()).toThrow(ChoicePendingError);

    const queued = c.pendingChoices.at(-1)!;
    expect(queued.kind).toBe("repeatWeaponBenefit");
    expect(queued.context?.current).toBe(REPLACEMENT);
    expect(queued.label).toContain(REPLACEMENT);
    expect(queued.options).toContain(`Bump ${REPLACEMENT}`);
    expect(queued.label).not.toContain(ORIGINAL);
  });
});
