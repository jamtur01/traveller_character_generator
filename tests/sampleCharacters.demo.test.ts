// Runnable sample viewer: `npm run sample`.
//
// Two modes, chosen by environment variables:
//
//   Curated (no SAMPLE_* vars): prints real generated character sheets that
//   span the outcome variety the seeded walkers produce — a full muster-out
//   survivor, a character who DIED in service, and an ACG enlistment WASHOUT —
//   across all four editions (Classic basic, MegaTraveller basic,
//   MegaTraveller ACG, Mongoose 2e). Each sample is located deterministically
//   by scanning seeds 1..K for the first character that reaches the target
//   terminal, then printed with a labelled header (edition · path · seed ·
//   outcome).
//
//   On-demand (SAMPLE_EDITION + SAMPLE_COMBO set): generates and prints ONE
//   chosen character instead of the curated set. The env-var interface:
//     - SAMPLE_EDITION — an active edition id (e.g. "ct-classic",
//       "mt-megatraveller", "mongoose-2e").
//     - SAMPLE_COMBO   — a combo selector: the filesystem-safe combo slug that
//       `npm run sample:dump` names its files with (the part after
//       `<edition>__`, with or without the `.txt` suffix; a full dumped
//       filename is also accepted). An unknown edition/slug fails loud and
//       lists the valid selectors.
//     - SAMPLE_SEED    — the dice seed (integer; defaults to
//       DEFAULT_SAMPLE_SEED). A seed that yields an inconsistent character
//       reddens via assertCharacterConsistent.
//   Example:
//     SAMPLE_EDITION=mt-megatraveller SAMPLE_COMBO=classic__service-navy \
//       SAMPLE_SEED=7 npm run sample
//
// This is a demo AND a test: every generated character (curated or on-demand)
// is run through assertCharacterConsistent BEFORE its sheet is printed, so a
// sheet carries real signal, never just text. Each curated sample also asserts
// the intended terminal was actually reached (the deceased sample IS deceased,
// the washout served zero terms). A curated scan that cannot find its target
// within K seeds, or an on-demand selector that matches no combo, fails loud —
// the viewer never silently prints nothing.

import { describe, expect, it } from "vitest";
import { walkAcg, walkBasic, walkMongoose, type WalkResult } from "@/tests/_walker";
import { assertCharacterConsistent } from "@/tests/_characterInvariants";
import { formatCharacterSheet } from "@/lib/traveller/sheet";
import type { Character } from "@/lib/traveller/character";
import type { HistoryEvent } from "@/lib/traveller/history";
import {
  selectCombo, walkCombo, comboLabel, DEFAULT_SAMPLE_SEED,
} from "@/tests/_comboWalk";

interface Selection {
  edition: string;
  combo: string;
  seed: number;
}

/** Parse the on-demand env-var interface. Returns null when NO SAMPLE_* var is
 *  set (curated mode). Requires both SAMPLE_EDITION and SAMPLE_COMBO once any
 *  SAMPLE_* var is set — a partial selection is a mistake, not a silent
 *  fallback to the curated set. */
function readSelection(): Selection | null {
  const edition = process.env.SAMPLE_EDITION;
  const combo = process.env.SAMPLE_COMBO;
  const seedRaw = process.env.SAMPLE_SEED;
  if (edition === undefined && combo === undefined && seedRaw === undefined) return null;
  if (edition === undefined || combo === undefined) {
    throw new Error(
      "sample: on-demand generation needs both SAMPLE_EDITION and SAMPLE_COMBO " +
        "(SAMPLE_SEED optional). Unset all three SAMPLE_* vars for the curated set.",
    );
  }
  const seed = seedRaw === undefined ? DEFAULT_SAMPLE_SEED : Number(seedRaw);
  if (!Number.isInteger(seed)) {
    throw new Error(`sample: SAMPLE_SEED must be an integer, got "${seedRaw}".`);
  }
  return { edition, combo, seed };
}

const SELECT = readSelection();

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

describe.skipIf(SELECT !== null)("sample characters — curated real sheets across the outcome variety", () => {
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
    assertCharacterConsistent(found.character);
    printSheet("CT — DECEASED", found);
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
    assertCharacterConsistent(found.character);
    printSheet("MT — MUSTER-OUT SURVIVOR", found);
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
    assertCharacterConsistent(found.character);
    printSheet("ACG — ENLISTMENT WASHOUT", found);
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
    assertCharacterConsistent(found.character);
    printSheet("MONGOOSE — MUSTERED OUT", found);
    expect(found.character.deceased).toBe(false);
    expect(found.character.chargenModelId).toBe("mongoose");
    expect(found.character.terms).toBeGreaterThanOrEqual(2);
  });
});

describe.runIf(SELECT !== null)("sample character — on-demand generated sheet", () => {
  it("generates, validates, and prints the selected character", () => {
    const sel = SELECT!;
    const combo = selectCombo(sel.edition, sel.combo);
    const { character } = walkCombo(combo, sel.seed);
    // Validate BEFORE printing: a sheet is surfaced only for a character whose
    // whole-character invariants hold (throws naming the violated invariant).
    assertCharacterConsistent(character);
    console.log(
      `\n========== ON-DEMAND · ${comboLabel(combo)} · seed=${sel.seed} ==========\n` +
        `${formatCharacterSheet(character)}\n`,
    );
  });
});
