// bpSpend policy audit-lock — Phase 1 of the ACG chargen re-architecture.
//
// The brownie-point auto-spend caps are NOT book rules. PM p. 46 says a player
// may spend "any number" of BP on a roll, so the manual sets no cap. The
// generator's auto-play needs a bounded spend policy and the interactive picker
// needs a finite option list, so those numbers are the *engine's* choice. This
// re-architecture externalizes them into
//
//     advancedCharacterGeneration.common.bpSpend
//
// tagged with a `$soloPolicy` citation (the mechanism that marks an
// engine-decided value the book leaves open, as opposed to a `$rule` book
// value). awards.ts must read them via requireRule instead of the current
// literals: autoMitigate's `?? "conservative"` (awards.ts:484) and
// `promotion ? 2 : 1` (awards.ts:493), and reviewBpSpend's `Math.min(available,
// 12)` (awards.ts:545).
//
// THREE LOCKS, each with independent teeth:
//   1. SCHEMA / CITATION (raw JSON): the block exists, carries a non-empty
//      $soloPolicy citation, and declares the four policy fields. Read straight
//      from the JSON file, never via an accessor, so it pins the on-disk data.
//   2. SHIPPED BEHAVIOR (real engine, shipped JSON): the caps read from the
//      JSON file drive tryMitigate on a real ACG character; the actual BP spend
//      matches the cap boundary. Mitigated at/below the cap (spends `need`),
//      NOT mitigated above it (spends 0). The expectation is derived from the
//      JSON value, so if the JSON cap moves the expectation moves with it.
//   3. SOURCE-OF-TRUTH (mutation): inject cap/picker/policy values that DIFFER
//      from the current code literals into the in-memory edition and assert the
//      engine follows the injected values. This is the only assertion that can
//      distinguish "engine reads the JSON" from "engine has a literal that
//      happens to equal the JSON" — value-equality (12 == 12) cannot.
//
// RED until the implementer lands the change:
//   - locks 1 & 2 fail because common.bpSpend is absent (undefined reads).
//   - lock 3 fails because awards.ts still uses the code literals (2, 1, 12,
//     "conservative") and ignores the injected JSON values.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Character } from "@/lib/traveller/character";
import { freshAcgState } from "@/lib/traveller/engine/acg/state";
import { getEdition } from "@/lib/traveller/editions";
import { tryMitigate, type MitigationRequest } from "@/lib/traveller/engine/acg/awards";
import { ChoicePendingError } from "@/lib/traveller/engine/choices";

const EDITION_ID = "mt-megatraveller";

// ---------------------------------------------------------------------------
// Raw JSON read (on-disk data — independent of the engine and its accessors).
// ---------------------------------------------------------------------------

const RAW = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../data/editions/mt-megatraveller.json"),
    "utf8",
  ),
) as Record<string, unknown>;

function rawBpSpend(): Record<string, unknown> | undefined {
  const acg = RAW.advancedCharacterGeneration as Record<string, unknown> | undefined;
  const common = acg?.common as Record<string, unknown> | undefined;
  return common?.bpSpend as Record<string, unknown> | undefined;
}

function rawConservativeCap(kind: "promotion" | "default"): unknown {
  const caps = rawBpSpend()?.conservativeCaps as Record<string, unknown> | undefined;
  return caps?.[kind];
}

// ---------------------------------------------------------------------------
// Live-edition access (what the engine actually reads — mutable shared object).
// ---------------------------------------------------------------------------

function editionCommon(): Record<string, unknown> {
  const data = getEdition(EDITION_ID).data as unknown as {
    advancedCharacterGeneration: { common: Record<string, unknown> };
  };
  return data.advancedCharacterGeneration.common;
}

// ---------------------------------------------------------------------------
// ACG character fixtures. tryMitigate is exercised directly with a hand-built
// MitigationRequest (as tests/browniePoints.test.ts does), so margins are
// exact and no dice are rolled — fully deterministic.
// ---------------------------------------------------------------------------

type AutoPolicy = "conservative" | "aggressive" | "manual";

function acgChar(
  opts: { bp: number; policy?: AutoPolicy; mode?: "auto" | "interactive" },
): Character {
  const c = new Character();
  c.editionId = EDITION_ID;
  c.showHistory = "none";
  c.choiceMode = opts.mode ?? "auto";
  c.attributes = {
    strength: 9, dexterity: 9, endurance: 9,
    intelligence: 9, education: 9, social: 9,
  };
  const acg = (c.acgState = freshAcgState("mercenary"));
  acg.browniePoints = opts.bp;
  if (opts.policy !== undefined) acg.bpAutoPolicy = opts.policy;
  return c;
}

/** A failed roll of `rollName`, failed by `by` (margin = -by). */
function fail(rollName: MitigationRequest["rollName"], by: number): MitigationRequest {
  return {
    rollName,
    rollValue: 0,
    dm: 0,
    target: 12,
    margin: -by,
    consequence: `${rollName} failure (test)`,
  };
}

// ---------------------------------------------------------------------------
// Lock 1: schema + $soloPolicy citation.
// ---------------------------------------------------------------------------

describe("bpSpend policy: schema + $soloPolicy citation lock", () => {
  it("advancedCharacterGeneration.common.bpSpend is a declared object", () => {
    const bp = rawBpSpend();
    expect(bp, "common.bpSpend must be declared in the edition JSON").toBeTypeOf(
      "object",
    );
    expect(bp).not.toBeNull();
  });

  it("carries a non-empty $soloPolicy citation (engine-choice, not a book rule)", () => {
    const soloPolicy = rawBpSpend()?.$soloPolicy;
    expect(
      soloPolicy,
      "bpSpend must carry a $soloPolicy citation string",
    ).toBeTypeOf("string");
    if (typeof soloPolicy === "string") {
      expect(soloPolicy.trim().length, "$soloPolicy must be non-empty").toBeGreaterThan(0);
    }
  });

  it("declares defaultAutoPolicy, conservativeCaps.{promotion,default}, pickerMax", () => {
    const bp = rawBpSpend();
    const caps = bp?.conservativeCaps as Record<string, unknown> | undefined;
    expect(bp?.defaultAutoPolicy).toBe("conservative");
    expect(caps?.promotion).toBe(2);
    expect(caps?.default).toBe(1);
    expect(bp?.pickerMax).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// Lock 2: shipped-JSON caps drive real engine spend (boundary behavior).
// ---------------------------------------------------------------------------

describe("bpSpend behavior: auto-mitigation caps track the shipped JSON block", () => {
  it("conservative promotion spends `need` up to the JSON promotion cap", () => {
    const cap = rawConservativeCap("promotion");
    expect(cap, "conservativeCaps.promotion must be a number in JSON").toBeTypeOf(
      "number",
    );
    const promoCap = cap as number;

    // fail-by-1: need (1) <= cap, so the engine spends exactly `need` (= 1), not
    // the cap. Pins spend == need, not a blind cap-sized spend.
    const c1 = acgChar({ bp: 20, policy: "conservative" });
    const out1 = tryMitigate(c1, fail("promotion", 1));
    expect(out1.spent).toBe(1);
    expect(out1.newMargin).toBe(0);
    expect(c1.browniePoints).toBe(19);

    // fail exactly at the cap: need (== cap) <= cap, engine spends the cap.
    const c2 = acgChar({ bp: 20, policy: "conservative" });
    const out2 = tryMitigate(c2, fail("promotion", promoCap));
    expect(out2.spent).toBe(promoCap);
    expect(out2.newMargin).toBe(0);
    expect(c2.browniePoints).toBe(20 - promoCap);
    expect(c2.acgState!.browniePointsSpent).toBe(promoCap);
  });

  it("conservative promotion does NOT mitigate a failure beyond the cap", () => {
    const cap = rawConservativeCap("promotion");
    expect(cap).toBeTypeOf("number");
    const promoCap = cap as number;

    // fail-by-(cap+1) == fail-by-3 (cap == 2): need > cap, so no spend.
    const c = acgChar({ bp: 20, policy: "conservative" });
    const out = tryMitigate(c, fail("promotion", promoCap + 1));
    expect(out.spent, `promotion failure by ${promoCap + 1} must not be mitigated`).toBe(0);
    expect(out.newMargin).toBe(-(promoCap + 1));
    expect(c.browniePoints).toBe(20);
    expect(c.acgState!.browniePointsSpent).toBe(0);
  });

  it("conservative skills spends `need` up to the JSON default cap", () => {
    const cap = rawConservativeCap("default");
    expect(cap, "conservativeCaps.default must be a number in JSON").toBeTypeOf(
      "number",
    );
    const defCap = cap as number;

    const c = acgChar({ bp: 20, policy: "conservative" });
    const out = tryMitigate(c, fail("skills", defCap));
    expect(out.spent).toBe(defCap);
    expect(out.newMargin).toBe(0);
    expect(c.browniePoints).toBe(20 - defCap);
  });

  it("conservative skills does NOT mitigate failures beyond the default cap", () => {
    const cap = rawConservativeCap("default");
    expect(cap).toBeTypeOf("number");
    const defCap = cap as number;

    // defCap+1 is the tight boundary (pins cap == 1, not 2); 3 is the
    // assignment's named "skills failure by 3" — both need > cap → no spend.
    for (const by of [defCap + 1, 3]) {
      const c = acgChar({ bp: 20, policy: "conservative" });
      const out = tryMitigate(c, fail("skills", by));
      expect(out.spent, `skills failure by ${by} must not be mitigated`).toBe(0);
      expect(c.browniePoints).toBe(20);
    }
  });
});

// ---------------------------------------------------------------------------
// Lock 3: the engine sources caps/picker/policy from JSON, not code literals.
// Inject values that DIFFER from the current literals and assert the engine
// follows the injected values. Restored per-test so the shared edition object
// is never left mutated.
// ---------------------------------------------------------------------------

describe("bpSpend behavior: engine reads caps/picker/policy from JSON, not literals", () => {
  const common = editionCommon();
  let hadBpSpend = false;
  let origBpSpend: unknown;

  beforeEach(() => {
    hadBpSpend = "bpSpend" in common;
    origBpSpend = common.bpSpend;
  });
  afterEach(() => {
    if (hadBpSpend) common.bpSpend = origBpSpend;
    else delete common.bpSpend;
  });

  function inject(block: Record<string, unknown>): void {
    common.bpSpend = block;
  }

  it("conservative promotion cap follows JSON conservativeCaps.promotion (=3)", () => {
    inject({
      $soloPolicy: "test policy",
      defaultAutoPolicy: "conservative",
      conservativeCaps: { promotion: 3, default: 1 },
      pickerMax: 12,
    });
    // need = 3. JSON cap 3 -> mitigated, spends 3. Code literal 2 -> spends 0.
    const c = acgChar({ bp: 20, policy: "conservative" });
    const out = tryMitigate(c, fail("promotion", 3));
    expect(out.spent).toBe(3);
    expect(out.newMargin).toBe(0);
    expect(c.browniePoints).toBe(17);
  });

  it("conservative default cap follows JSON conservativeCaps.default (=2)", () => {
    inject({
      $soloPolicy: "test policy",
      defaultAutoPolicy: "conservative",
      conservativeCaps: { promotion: 2, default: 2 },
      pickerMax: 12,
    });
    // skills need = 2. JSON cap 2 -> mitigated, spends 2. Code literal 1 -> 0.
    const c = acgChar({ bp: 20, policy: "conservative" });
    const out = tryMitigate(c, fail("skills", 2));
    expect(out.spent).toBe(2);
    expect(out.newMargin).toBe(0);
    expect(c.browniePoints).toBe(18);
  });

  it("default auto-policy follows JSON defaultAutoPolicy when the character sets none (=aggressive)", () => {
    inject({
      $soloPolicy: "test policy",
      defaultAutoPolicy: "aggressive",
      conservativeCaps: { promotion: 2, default: 1 },
      pickerMax: 12,
    });
    // bpAutoPolicy UNSET -> engine falls back to JSON defaultAutoPolicy.
    // aggressive -> maxSpend = need = 3 -> spends 3. Code `?? "conservative"`
    // -> promotion cap 2, need 3 > 2 -> spends 0.
    const c = acgChar({ bp: 20 });
    const out = tryMitigate(c, fail("promotion", 3));
    expect(out.spent).toBe(3);
    expect(out.newMargin).toBe(0);
    expect(c.browniePoints).toBe(17);
  });

  it("interactive picker bound follows JSON pickerMax (=5)", () => {
    inject({
      $soloPolicy: "test policy",
      defaultAutoPolicy: "conservative",
      conservativeCaps: { promotion: 2, default: 1 },
      pickerMax: 5,
    });
    // promotion fail-by-3: auto layer spends 0 (cap 2), then reviewBpSpend
    // offers min(available, pickerMax) "spend N more" options plus one "spend 0"
    // option. JSON pickerMax 5 -> 6 options. Code literal 12 -> 13 options.
    const c = acgChar({ bp: 20, policy: "conservative", mode: "interactive" });
    expect(() => tryMitigate(c, fail("promotion", 3))).toThrow(ChoicePendingError);
    const picker = c.pendingChoices.find((p) => p.kind === "bpSpend");
    expect(picker, "reviewBpSpend must queue a bpSpend picker").toBeDefined();
    expect(picker?.options.length).toBe(6);
  });
});
