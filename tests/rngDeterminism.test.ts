// Determinism payoff of the ownable-RNG migration: every engine dice/selection
// draw flows through a per-Character owned `Rng` (character.rng), so a seeded
// character reproduces its entire run — construction AND engine draws — rather
// than depending on hidden global Math.random state. These tests pin that
// guarantee end-to-end and are designed to FAIL if any engine draw is ever
// reintroduced against bare Math.random (or the free roll()/arnd()/rndInt()
// helpers, which delegate to an unseeded ambient Rng that calls Math.random).

import { afterEach, describe, expect, it, vi } from "vitest";
import { Character } from "../lib/traveller/character";

afterEach(() => {
  vi.restoreAllMocks();
});

/** A seeded MT character configured for a silent, auto-resolved run. The seed
 *  makes the whole run reproducible: attributes/gender/name are drawn from
 *  c.rng at construction, and every engine roll/pick draws from it thereafter. */
function seededMtChar(seed: number): Character {
  const c = new Character({ seed });
  c.editionId = "mt-megatraveller";
  c.choiceMode = "auto";
  c.showHistory = "none";
  return c;
}

/** Drive a character through a fixed sequence of engine operations that make
 *  many dice/selection draws: homeworld generation, random enlistment, then
 *  several service terms with aging and reenlistment. Guarded on
 *  isChargenEnded so an identical code path runs for every character. */
function driveRun(c: Character): void {
  c.generateHomeworld();
  c.service = c.doEnlistment("");
  for (let term = 0; term < 6 && !c.isChargenEnded; term++) {
    c.doServiceTermStep();
    if (c.isChargenEnded) break;
    c.doAging();
    if (c.isChargenEnded) break;
    c.doReenlistmentStep();
  }
}

/** The externally observable state two identically-seeded runs must agree on.
 *  Deep equality here is the migration payoff: it can only hold if every
 *  engine draw stayed inside the owned, seeded stream. */
function observableState(c: Character) {
  return {
    attributes: c.attributes,
    gender: c.gender,
    name: c.name,
    skills: c.skills,
    service: c.service,
    rank: c.rank,
    terms: c.terms,
    age: c.age,
    credits: c.credits,
    deceased: c.deceased,
    drafted: c.drafted,
    commissioned: c.commissioned,
    history: c.history,
  };
}

describe("seeded RNG determinism", () => {
  it("same seed → identical construction (attributes, gender, name)", () => {
    const a = new Character({ seed: 12345 });
    const b = new Character({ seed: 12345 });
    expect(a.attributes).toEqual(b.attributes);
    expect(a.gender).toBe(b.gender);
    expect(a.name).toBe(b.name);
  });

  it("different seed → different construction", () => {
    const a = new Character({ seed: 12345 });
    const c = new Character({ seed: 67890 });
    // The full construction tuple must differ. A collision on gender AND name
    // AND all six attributes across two distinct seeds is astronomically
    // unlikely, so this pins that the seed is not silently ignored or hardcoded
    // (either regression would make every seed yield the same character).
    const identical =
      a.gender === c.gender &&
      a.name === c.name &&
      JSON.stringify(a.attributes) === JSON.stringify(c.attributes);
    expect(identical).toBe(false);
  });

  it("full seeded run is reproducible across two identically-seeded characters", () => {
    const a = seededMtChar(0xc0ffee);
    const b = seededMtChar(0xc0ffee);
    driveRun(a);
    driveRun(b);
    // Deep equality on observable state (attributes, skills, service, rank,
    // terms, credits, deceased, rendered history). Both runs share one seed and
    // one owned stream, so they diverge the instant any engine draw escapes to
    // an unseeded source: a reintroduced bare Math.random (or a free
    // roll()/arnd() call, which delegates to the unseeded defaultRng) returns
    // different values on the two independent runs, breaking this equality.
    expect(observableState(a)).toEqual(observableState(b));
    // Guard against a vacuous pass: the run must actually advance state so the
    // equality above is over real, draw-derived data.
    expect(a.terms).toBeGreaterThan(0);
    expect(a.history.length).toBeGreaterThan(0);
  });

  it("a fully-seeded run draws zero times from bare Math.random", () => {
    // The sharpest teeth: a seeded character owns a mulberry32 stream and never
    // touches Math.random. The free roll()/arnd()/rndInt() helpers, by
    // contrast, delegate to an unseeded ambient Rng that DOES call Math.random.
    // So if any engine draw regressed to a free helper or a bare Math.random,
    // this spy fires — deterministically, on every run, not just probabilistically.
    const mathRandom = vi.spyOn(Math, "random");
    const c = seededMtChar(0xbeef);
    driveRun(c);
    expect(mathRandom).not.toHaveBeenCalled();
    // Sanity: the run genuinely exercised the engine, so "not called" is not
    // vacuously true because nothing happened.
    expect(c.terms).toBeGreaterThan(0);
  });
});
