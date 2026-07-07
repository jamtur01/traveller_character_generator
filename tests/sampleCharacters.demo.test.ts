// Runnable sample viewer: `npm run sample`.
//
// Curates and prints real generated character sheets that span the outcome
// variety the seeded walkers produce — a full muster-out survivor, a character
// who DIED in service, and an ACG enlistment WASHOUT — across all four editions
// (Classic basic, MegaTraveller basic, MegaTraveller ACG, Mongoose 2e). Each
// sample is located deterministically by scanning seeds 1..K for the first
// character that reaches the target terminal, then printed with a labelled
// header (edition · path · seed · outcome).
//
// This is a demo AND a test: every printed character is run through
// assertCharacterConsistent (so the sheets carry real signal, not just text),
// and each sample asserts the intended terminal was actually reached (the
// deceased sample IS deceased, the washout served zero terms). A scan that
// cannot find its target within K seeds fails loud — the demo never silently
// prints nothing.

import { describe, expect, it } from "vitest";
import { walkAcg, walkBasic, walkMongoose, type WalkResult } from "@/tests/_walker";
import { assertCharacterConsistent } from "@/tests/_characterInvariants";
import { formatCharacterSheet } from "@/lib/traveller/sheet";
import type { Character } from "@/lib/traveller/character";
import type { HistoryEvent } from "@/lib/traveller/history";

// K — seeds scanned per config to locate each curated outcome. 60 leaves ample
// margin over the density measured by fullCoverageSeeded.test.ts (deaths and
// ACG washouts each land within the first ~20 seeds for the configs below), so
// the scan finds its target early; K only bounds the failure case.
const SCAN_SEEDS = 60;

type EndEvent = Extract<HistoryEvent, { kind: "endGeneration" }>;

/** The terminal reason from the (single) endGeneration event — survives the
 *  enterMuster status overwrite (see fullCoverageSeeded.test.ts). */
function endReason(ch: Character): EndEvent["reason"] | undefined {
  const end = ch.events.find((e): e is EndEvent => e.kind === "endGeneration");
  return end?.reason;
}

interface Config {
  /** Label naming the edition/path this config walks. */
  detail: string;
  walk: (seed: number) => WalkResult;
}

interface Curated {
  character: Character;
  seed: number;
  detail: string;
}

/** Scan each config across seeds 1..K and return the first walk matching the
 *  predicate. Throws a loud, actionable error if no config yields a match —
 *  a curated outcome that can no longer be produced is a regression, not a
 *  reason to silently skip the sample. */
function scan(configs: Config[], predicate: (r: WalkResult) => boolean, what: string): Curated {
  for (const cfg of configs) {
    for (let seed = 1; seed <= SCAN_SEEDS; seed++) {
      const r = cfg.walk(seed);
      if (predicate(r)) return { character: r.character, seed, detail: cfg.detail };
    }
  }
  throw new Error(
    `sampleCharacters: no ${what} found across ${configs.length} config(s) × ` +
    `${SCAN_SEEDS} seeds — the outcome path may have regressed`,
  );
}

function printSheet(label: string, c: Curated): void {
  console.log(
    `\n========== ${label} · ${c.detail} · seed=${c.seed} ==========\n` +
    `${formatCharacterSheet(c.character)}\n`,
  );
}

describe("sample characters — curated real sheets across the outcome variety", () => {
  it("CT: a character who DIED in service", () => {
    const found = scan(
      [
        { detail: "ct-classic · scouts", walk: (s) => walkBasic({ edition: "ct-classic", service: "scouts", seed: s }) },
        { detail: "ct-classic · marines", walk: (s) => walkBasic({ edition: "ct-classic", service: "marines", seed: s }) },
        { detail: "ct-classic · army", walk: (s) => walkBasic({ edition: "ct-classic", service: "army", seed: s }) },
      ],
      (r) => r.character.deceased,
      "CT deceased character",
    );
    printSheet("CT — DECEASED", found);
    assertCharacterConsistent(found.character);
    expect(found.character.deceased).toBe(true);
    expect(endReason(found.character)).toBe("deceased");
  });

  it("MT: a full muster-out survivor (served terms, left with benefits)", () => {
    const found = scan(
      [
        { detail: "mt-megatraveller · navy", walk: (s) => walkBasic({ edition: "mt-megatraveller", service: "navy", seed: s }) },
        { detail: "mt-megatraveller · merchants", walk: (s) => walkBasic({ edition: "mt-megatraveller", service: "merchants", seed: s }) },
        { detail: "mt-megatraveller · army", walk: (s) => walkBasic({ edition: "mt-megatraveller", service: "army", seed: s }) },
      ],
      (r) => {
        const ch = r.character;
        const reason = endReason(ch);
        return !ch.deceased && ch.terms >= 2 && ch.benefits.length > 0
          && (reason === "mustered" || reason === "retired");
      },
      "MT muster-out survivor",
    );
    printSheet("MT — MUSTER-OUT SURVIVOR", found);
    assertCharacterConsistent(found.character);
    expect(found.character.deceased).toBe(false);
    expect(found.character.terms).toBeGreaterThanOrEqual(2);
    expect(found.character.benefits.length).toBeGreaterThan(0);
  });

  it("ACG (MegaTraveller advanced): an enlistment WASHOUT (never served)", () => {
    const found = scan(
      [
        { detail: "mt-megatraveller · acg navy", walk: (s) => walkAcg({ pathway: "navy", seed: s }) },
        { detail: "mt-megatraveller · acg scout", walk: (s) => walkAcg({ pathway: "scout", seed: s }) },
      ],
      (r) => r.snap.phase === "end" && r.character.terms === 0 && !r.character.deceased,
      "ACG enlistment washout",
    );
    printSheet("ACG — ENLISTMENT WASHOUT", found);
    assertCharacterConsistent(found.character);
    // A washout fails enlistment before any term runs: zero terms served, and
    // the acg model logs endGeneration("retired") at enlist rather than dying.
    expect(found.character.terms).toBe(0);
    expect(found.character.deceased).toBe(false);
    expect(endReason(found.character)).toBe("retired");
  });

  it("Mongoose: a completed character (careers served, mustered out)", () => {
    const found = scan(
      [
        { detail: "mongoose-2e · auto career", walk: (s) => walkMongoose({ seed: s }) },
      ],
      (r) => !r.character.deceased && r.character.terms >= 2 && endReason(r.character) === "mustered",
      "Mongoose mustered character",
    );
    printSheet("MONGOOSE — MUSTERED OUT", found);
    assertCharacterConsistent(found.character);
    expect(found.character.deceased).toBe(false);
    expect(found.character.chargenModelId).toBe("mongoose");
    expect(found.character.terms).toBeGreaterThanOrEqual(2);
  });
});
