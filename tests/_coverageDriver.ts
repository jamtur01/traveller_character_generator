// Coverage-ledger run driver. Turns coverageMatrix() combos into finished
// characters across a broad-but-FAST run set for tests/coverageLedger.test.ts.
//
// It REUSES the shared seeded walkers (tests/_walker.ts) for the base spread,
// pre-career enumeration, and the multi-career mongoose walk, and adds the two
// knobs the walkers deliberately don't expose:
//   - a varied drainChoices `pick` (choice-index fuzzing): the walkers always
//     take option 0, so a cascade's non-first members and a career's non-first
//     assignment are never chosen. Re-driving the same seeded dice stream with
//     pick 1..k reaches those leaves without touching the dice.
//   - a "cash" muster-out: the walkers only ever roll Benefit, so the
//     muster.cash rows are never landed. A cash walk rolls the Cash column.
//
// Every character these drivers produce is a normal, rules-legal finished
// character (a different valid pick / a Cash roll instead of a Benefit roll),
// so assertCharacterConsistent holds over all of them — the ledger validates.
// Determinism is unchanged: the session re-executes from a seeded base, so a
// fixed (combo, seed, pick) triples to a fixed character.

import * as session from "@/lib/traveller/chargen/session";
import type { EnlistOptions, PreCareerOption } from "@/lib/traveller/chargen/session";
import { drainChoices, walkAcg, walkBasic, walkMongoose, type WalkResult } from "@/tests/_walker";
import { coverageMatrix, type CoverageCombo } from "@/tests/_coverageMatrix";
import { preCareerOptionKeys } from "@/tests/_coverageUniverse";
import type { Character } from "@/lib/traveller/character";

type WalkBasicOpts = Parameters<typeof walkBasic>[0];
type WalkAcgOpts = Parameters<typeof walkAcg>[0];

// Registry picks arrive as Readonly<Record<string,string>>; the option-domain
// audit-locks + coverageMatrix self-check prove those values ARE the declared
// union members, so narrowing them to the walker's literal-union params is a
// sound unchecked cast (the compiler cannot narrow a Record read). Mirrors the
// same casts in fullCoverage(Seeded).test.ts's driveCombo.
type ClassicEdition = WalkBasicOpts["edition"];
type AcgPathway = WalkAcgOpts["pathway"];

/** Enlist options for a mongoose walk (the model reads only `verbose`; the
 *  acg/service fields are inert). Mirrors the walker's MONGOOSE_ENLIST. */
const MONGOOSE_ENLIST: EnlistOptions = {
  verbose: true, preferredService: "random", acgService: "army", acgCombatArm: "",
  acgFleet: "imperialNavy", acgDivision: "field", acgLineType: "", acgSubsectorTech: "",
  acgMerchantAcademy: false,
};

/** Dispatch a combo to its seeded walker for the base run (drainChoices pick 0,
 *  Benefit muster). Reuses the shared walkers verbatim. */
export function driveSeeded(combo: CoverageCombo, seed: number): WalkResult {
  switch (combo.model) {
    case "classic":
      return walkBasic({ edition: combo.edition as ClassicEdition, service: combo.service, seed });
    case "acg":
      return walkAcg(acgOptsFromCombo(combo.pathway, combo.picks, seed));
    case "mongoose":
      return walkMongoose({ career: combo.career, seed });
  }
}

/** Build walkAcg opts from a combo's pathway + picks. exactOptionalPropertyTypes
 *  forbids an explicit `undefined`, and a pathway's picks only carry the
 *  sub-domains it crosses, so each optional field is set only when present. */
function acgOptsFromCombo(
  pathway: string, picks: Readonly<Record<string, string>>, seed: number,
): WalkAcgOpts {
  const opts: WalkAcgOpts = { pathway: pathway as AcgPathway, seed };
  if (picks.acgService !== undefined) opts.service = picks.acgService as EnlistOptions["acgService"];
  if (picks.acgCombatArm !== undefined) opts.combatArm = picks.acgCombatArm;
  if (picks.acgFleet !== undefined) opts.fleet = picks.acgFleet as EnlistOptions["acgFleet"];
  if (picks.acgDivision !== undefined) opts.division = picks.acgDivision as EnlistOptions["acgDivision"];
  if (picks.acgLineType !== undefined) opts.lineType = picks.acgLineType;
  if (picks.acgSubsectorTech !== undefined) opts.subsectorTech = picks.acgSubsectorTech;
  return opts;
}

/** Classic/MT-basic walk with two knobs the shared walker doesn't expose: the
 *  drainChoices `pick` (choice-index fuzzing → non-first cascade members) and
 *  the muster kind ("cash" reaches the muster.cash rows the walker never
 *  rolls). Otherwise identical to walkBasic (seeded, non-interactive). */
export function walkClassicVaried(opts: {
  edition: ClassicEdition;
  service: string;
  seed: number;
  pick?: number;
  muster?: "benefit" | "cash";
  maxTerms?: number;
}): WalkResult {
  const pick = opts.pick ?? 0;
  const wantCash = opts.muster === "cash";
  const snap0 = session.startCareer({
    edition: opts.edition, verbose: true, interactiveMode: false,
    supportsInteractive: false, useAcg: false, acgPathway: "", seed: opts.seed,
  });
  let snap = session.enlist(snap0, {
    verbose: true, preferredService: opts.service, acgService: "army", acgCombatArm: "Infantry",
    acgFleet: "imperialNavy", acgDivision: "field", acgLineType: "Free Trader",
    acgSubsectorTech: "", acgMerchantAcademy: false,
  });
  const resolved: WalkResult["resolved"] = [];
  const eventCountTrail: number[] = [];
  const termsTrail: number[] = [];
  const maxTerms = opts.maxTerms ?? 4;
  for (let i = 0; i < maxTerms; i++) {
    if (snap.phase === "end") break;
    snap = session.runTerm(snap);
    snap = drainChoices(snap, pick, resolved);
    while (snap.phase === "skill_basic" || snap.phase === "skill_adv") {
      snap = session.pickSkill(snap, 0);
      snap = drainChoices(snap, pick, resolved);
    }
    eventCountTrail.push(snap.character.events.length);
    termsTrail.push(snap.character.terms);
    if (snap.phase !== "term") break;
  }
  while (snap.phase === "muster" || snap.phase === "muster_no_cash") {
    // "cash" is only rollable in the "muster" phase; muster_no_cash has spent
    // the cash rolls, so fall back to Benefit there.
    const kind = wantCash && snap.phase === "muster" ? "cash" : "benefit";
    snap = session.musterChoice(snap, kind);
    snap = drainChoices(snap, pick, resolved);
  }
  return { character: snap.character, snap, resolved, eventCountTrail, termsTrail };
}

/** ACG walk exposing the drainChoices `pick` for cascade/assignment fuzzing;
 *  otherwise identical to walkAcg (skip pre-career, seeded, non-interactive). */
export function walkAcgVaried(combo: {
  pathway: string;
  picks: Readonly<Record<string, string>>;
  seed: number;
  pick?: number;
  maxTerms?: number;
}): WalkResult {
  const pick = combo.pick ?? 0;
  const base = acgOptsFromCombo(combo.pathway, combo.picks, combo.seed);
  const snap0 = session.startCareer({
    edition: "mt-megatraveller", verbose: true, interactiveMode: false,
    supportsInteractive: true, useAcg: true, acgPathway: base.pathway, seed: combo.seed,
  });
  const skipped = session.applyPreCareer(snap0, "skip");
  let snap = session.enlist(skipped.snapshot, {
    verbose: true, preferredService: "random",
    acgService: base.service ?? "army", acgCombatArm: base.combatArm ?? "Infantry",
    acgFleet: base.fleet ?? "imperialNavy", acgDivision: base.division ?? "field",
    acgLineType: base.lineType ?? "Free Trader", acgSubsectorTech: base.subsectorTech ?? "",
    acgMerchantAcademy: false,
  });
  const resolved: WalkResult["resolved"] = [];
  const eventCountTrail: number[] = [];
  const termsTrail: number[] = [];
  const maxTerms = combo.maxTerms ?? 4;
  for (let i = 0; i < maxTerms; i++) {
    if (snap.phase === "end") break;
    snap = session.runTerm(snap);
    snap = drainChoices(snap, pick, resolved);
    eventCountTrail.push(snap.character.events.length);
    termsTrail.push(snap.character.terms);
    if (snap.phase !== "term") break;
  }
  while (snap.phase === "muster" || snap.phase === "muster_no_cash") {
    snap = session.musterChoice(snap, "benefit");
    snap = drainChoices(snap, pick, resolved);
  }
  return { character: snap.character, snap, resolved, eventCountTrail, termsTrail };
}

/** Drain mongoose choices, resolving a `mongooseCareer` prompt to `career` (so
 *  the target career is attempted) and every other prompt to `pick` (clamped),
 *  so assignment/skill/event choices past option 0 get reached. */
function drainMongooseVaried(
  snap: session.ChargenSnapshot, career: string, pick: number,
  resolved: WalkResult["resolved"], cap = 80,
): session.ChargenSnapshot {
  let cur = snap;
  let n = 0;
  while (cur.character.pendingChoices.length > 0) {
    if (++n > cap) {
      throw new Error(`walkMongooseVaried: runaway choice queue (${cap}) at kinds ` +
        cur.character.pendingChoices.map((c) => c.kind).join(", "));
    }
    const c = cur.character.pendingChoices[0]!;
    let idx = Math.min(pick, c.options.length - 1);
    if (c.kind === "mongooseCareer") {
      const target = c.options.indexOf(career);
      idx = target >= 0 ? target : 0;
    }
    resolved.push({ kind: c.kind, pick: idx, label: c.label });
    cur = session.resolvePending(cur, c.id, idx).snapshot;
  }
  return cur;
}

/** Mongoose walk exposing the drainChoices `pick` for assignment fuzzing;
 *  otherwise mirrors walkMongoose (seeded, career-targeted, bounded). */
export function walkMongooseVaried(opts: {
  career: string;
  seed: number;
  pick?: number;
  maxTerms?: number;
  maxCareers?: number;
}): WalkResult {
  const pick = opts.pick ?? 0;
  const snap0 = session.startCareer({
    edition: "mongoose-2e", verbose: true, interactiveMode: true,
    supportsInteractive: true, useAcg: false, acgPathway: "", seed: opts.seed,
  });
  const resolved: WalkResult["resolved"] = [];
  const eventCountTrail: number[] = [];
  const termsTrail: number[] = [];
  const maxTerms = opts.maxTerms ?? 4;
  const maxCareers = opts.maxCareers ?? 1;
  // Generous: a fuzzed pick changes the deterministic dice path and can trip
  // extra "must continue" terms, so allow more slack than the base walker.
  const stepCap = maxCareers * (maxTerms + 12) + 24;
  let snap = snap0;
  let steps = 0;
  while (snap.phase !== "end") {
    if (++steps > stepCap) {
      throw new Error(`walkMongooseVaried: step cap ${stepCap} exceeded at "${snap.phase}"`);
    }
    const st = snap.character.mongooseState;
    if (snap.phase === "career") {
      snap = (st?.careerCount ?? 0) >= maxCareers
        ? session.attemptMusterOut(snap)
        : session.enlist(snap, MONGOOSE_ENLIST);
    } else if (snap.phase === "term") {
      const mustStay = st?.perTerm.mustContinue ?? false;
      snap = !mustStay && st !== null && st.termsInCareer >= maxTerms
        ? session.attemptMusterOut(snap)
        : session.runTerm(snap);
      eventCountTrail.push(snap.character.events.length);
      termsTrail.push(snap.character.terms);
    } else {
      throw new Error(`walkMongooseVaried: unexpected phase "${snap.phase}"`);
    }
    snap = drainMongooseVaried(snap, opts.career, pick, resolved);
  }
  return { character: snap.character, snap, resolved, eventCountTrail, termsTrail };
}

// ---------------------------------------------------------------------------
// Ledger run set. The broad-but-FAST plan tests/coverageLedger.test.ts unions
// touchedTags over. Every dimension is a CHEAP knob on the seeded walkers, not
// a forced-outcome scenario; see the test for the justification of each count.
// ---------------------------------------------------------------------------

/** Deterministic parameters for the ledger run set. */
export interface LedgerParams {
  /** Base seeds (1..seeds) per classic/acg combo. */
  readonly seeds: number;
  /** Base + maxCareers=2 seeds (1..mgtSeeds) per mongoose career, drained at
   *  pick 0. Kept MODERATE: specific seeds deterministically trip a natural-12
   *  "must remain" chain the walker caps (a wasteful skip), so this stays in the
   *  proven-terminating range (walkSkips == 0 is asserted by the ledger). */
  readonly mgtSeeds: number;
  /** Seeds (1..mgtFuzzSeeds) per fuzz pick for the mongoose assignment fuzz.
   *  Decoupled from fuzzSeeds and kept lower: a fuzzed (non-0) pick perturbs the
   *  dice path and trips the "must remain" cap at lower seeds than a pick-0 walk,
   *  so classic/acg fuzz can go aggressive while mongoose fuzz stays safe. */
  readonly mgtFuzzSeeds: number;
  /** Seeds per classic combo for the long-term Cash+Benefit muster walks. */
  readonly cashSeeds: number;
  /** Term budget for the muster walks (more terms → higher rank → the +1 DM
   *  that lands muster row 7). */
  readonly musterTerms: number;
  /** drainChoices picks for choice-index fuzzing (non-first cascade members /
   *  career assignments). */
  readonly fuzzPicks: readonly number[];
  /** Seeds per fuzz pick. */
  readonly fuzzSeeds: number;
  /** Seeds per pre-career school option. */
  readonly precareerSeeds: number;
  /** MT-barbarians is homeworld-gated (requiresTechExactly Pre-Industrial, mt
   *  JSON) — reachable only on a primitive homeworld (~0.1% of worldgen). These
   *  seeds deterministically generate one, so the enlist lands barbarians. */
  readonly barbariansSeeds: readonly number[];
}

export const LEDGER_PARAMS: LedgerParams = {
  seeds: 60,
  mgtSeeds: 21,
  mgtFuzzSeeds: 16,
  cashSeeds: 50,
  musterTerms: 6,
  fuzzPicks: [1, 2, 3, 4, 5, 6],
  fuzzSeeds: 36,
  precareerSeeds: 3,
  barbariansSeeds: [685, 1312, 2040, 2351, 2613, 3284, 4328, 8323, 10959],
};

export interface LedgerRunStats {
  /** Walks that produced a finished character (passed to `visit`). */
  driven: number;
  /** Walks whose thunk threw (a pathological runaway seed) — skipped, counted. */
  walkSkips: number;
  /** One labelled message per skipped walk. */
  walkErrors: string[];
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i + 1);
}

function comboLabel(combo: CoverageCombo): string {
  if (combo.model === "classic") return `${combo.edition}/classic/${combo.service}`;
  if (combo.model === "mongoose") return `${combo.edition}/mongoose/${combo.career}`;
  return `${combo.edition}/acg/${combo.pathway}`;
}

type RunFn = (label: string, thunk: () => WalkResult) => void;

function driveBaseCombo(combo: CoverageCombo, p: LedgerParams, run: RunFn): void {
  const n = combo.model === "mongoose" ? p.mgtSeeds : p.seeds;
  const label = comboLabel(combo);
  for (const seed of range(n)) run(`base ${label} seed=${seed}`, () => driveSeeded(combo, seed));
}

function driveClassicExtra(
  combo: Extract<CoverageCombo, { model: "classic" }>, p: LedgerParams, run: RunFn,
): void {
  const edition = combo.edition as ClassicEdition;
  const label = comboLabel(combo);
  for (const seed of range(p.cashSeeds)) {
    run(`cash ${label} seed=${seed}`, () =>
      walkClassicVaried({ edition, service: combo.service, seed, muster: "cash", maxTerms: p.musterTerms }));
    run(`benefit ${label} seed=${seed}`, () =>
      walkClassicVaried({ edition, service: combo.service, seed, maxTerms: p.musterTerms }));
  }
  for (const pick of p.fuzzPicks) for (const seed of range(p.fuzzSeeds)) {
    run(`fuzz ${label} pick=${pick} seed=${seed}`, () =>
      walkClassicVaried({ edition, service: combo.service, seed, pick }));
  }
}

function driveAcgExtra(
  combo: Extract<CoverageCombo, { model: "acg" }>, p: LedgerParams, run: RunFn,
): void {
  const label = comboLabel(combo);
  for (const pick of p.fuzzPicks) for (const seed of range(p.fuzzSeeds)) {
    run(`fuzz ${label} pick=${pick} seed=${seed}`, () =>
      walkAcgVaried({ pathway: combo.pathway, picks: combo.picks, seed, pick }));
  }
}

function driveMongooseExtra(
  combo: Extract<CoverageCombo, { model: "mongoose" }>, p: LedgerParams, run: RunFn,
): void {
  const label = comboLabel(combo);
  for (const seed of range(p.mgtSeeds)) {
    run(`2careers ${label} seed=${seed}`, () =>
      walkMongooseVaried({ career: combo.career, seed, maxCareers: 2 }));
  }
  for (const pick of p.fuzzPicks) for (const seed of range(p.mgtFuzzSeeds)) {
    run(`fuzz ${label} pick=${pick} seed=${seed}`, () =>
      walkMongooseVaried({ career: combo.career, seed, pick }));
  }
}

function driveBarbarians(p: LedgerParams, run: RunFn): void {
  const edition: ClassicEdition = "mt-megatraveller";
  for (const seed of p.barbariansSeeds) {
    run(`barb cash seed=${seed}`, () =>
      walkClassicVaried({ edition, service: "barbarians", seed, muster: "cash", maxTerms: p.musterTerms }));
    run(`barb benefit seed=${seed}`, () =>
      walkClassicVaried({ edition, service: "barbarians", seed, maxTerms: p.musterTerms }));
    for (const pick of p.fuzzPicks) {
      run(`barb fuzz pick=${pick} seed=${seed}`, () =>
        walkClassicVaried({ edition, service: "barbarians", seed, pick }));
    }
  }
}

function drivePreCareer(p: LedgerParams, run: RunFn): void {
  // preCareerOptionKeys returns the declared school option keys, which ARE the
  // PreCareerOption union members (proven by the ACG pre-career audit locks).
  for (const key of preCareerOptionKeys("mt-megatraveller")) {
    const option = key as PreCareerOption;
    for (const seed of range(p.precareerSeeds)) {
      run(`precareer ${key} seed=${seed}`, () =>
        walkAcg({ pathway: "scout", preCareer: option, seed }));
    }
  }
}

/** Drive the whole ledger run set, invoking `visit` with every finished
 *  character a walk produced. A walk that throws (a pathological seed whose
 *  deterministic dice trip a runaway "must continue" chain the walker caps) is
 *  skipped and counted, never fatal — the base spread uses seeds proven to
 *  terminate, so skips stay at zero in practice (asserted by the ledger). */
export function driveLedgerRunSet(
  visit: (ch: Character, label: string) => void, params: LedgerParams = LEDGER_PARAMS,
): LedgerRunStats {
  const stats: LedgerRunStats = { driven: 0, walkSkips: 0, walkErrors: [] };
  const run: RunFn = (label, thunk) => {
    let result: WalkResult;
    try {
      result = thunk();
    } catch (err) {
      stats.walkSkips += 1;
      stats.walkErrors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    stats.driven += 1;
    visit(result.character, label);
  };
  for (const combo of coverageMatrix()) {
    driveBaseCombo(combo, params, run);
    if (combo.model === "classic") driveClassicExtra(combo, params, run);
    else if (combo.model === "acg") driveAcgExtra(combo, params, run);
    else driveMongooseExtra(combo, params, run);
  }
  driveBarbarians(params, run);
  drivePreCareer(params, run);
  return stats;
}
