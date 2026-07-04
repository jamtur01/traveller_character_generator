// Live-vs-replay equivalence property harness.
//
// The upcoming resume-model rewrite replaces the live pause/resume machinery
// (acgState.perYear.pausedAtStep, the per-year subStepCache, the scout/merchant
// closure-cache fields) with event-sourced re-execution: a session becomes a
// RunLog {seed, start, actions} and every render re-derives state via
// replayRun. Before that machinery is deleted, this harness proves — or
// pinpoints where — TODAY'S live interactive path is equivalent to pure
// re-execution, across both editions and every ACG pathway.
//
// It generalizes tests/replay.test.ts's driveChargen loop: a config-
// parameterized driver walks each (config, seed) run to a terminal phase via
// the session actions the UI can actually issue, recording a RunLog. Every
// decision (pre-career school, service, skill table, muster kind, choice
// option index) is derived from a seed-keyed PRNG — never a fixed index — so
// branches are genuinely explored. Four properties are then checked per run:
//
//   P1 determinism        replayRun(L) twice → identical observable state.
//   P2 live ≡ replay      the driven snapshot (which exercised pause/resume)
//                         equals replayRun(L). The load-bearing property.
//   P3 prefix consistency applyChargenAction(replayRun(L[:k]), L[k]) equals
//                         replayRun(L[:k+1]) for sampled k.
//   P4 RNG-stream         3 draws from a clone() of each final character's
//                         rng agree — the stream POSITION matches, not just
//                         the visible state.
//
// If a property fails for some (config, seed): do NOT weaken assertions —
// add the minimal failing case to KNOWN_DIVERGENCES (which skips it in the
// property loop and emits an it.todo naming the diverging field) and report.

import { describe, expect, it } from "vitest";
import type { Character } from "../lib/traveller/character";
import { Rng } from "../lib/traveller/random";
import {
  applyChargenAction, replayRun,
  type ChargenAction, type RunLog,
} from "../lib/traveller/chargen/replay";
import {
  startCareer,
  type ChargenSnapshot, type EnlistOptions, type StartCareerOptions,
} from "../lib/traveller/chargen/session";
import { getEnlistableServices } from "../lib/traveller/services";
import { getAcgPathway } from "../lib/traveller/editions";
import {
  isPreCareerEligible, type PreCareerOption,
} from "../lib/traveller/engine/acg/preCareer";

// ---------------------------------------------------------------------------
// Configs. All interactive (choiceMode "interactive") — that is the mode the
// pause/resume machinery serves. ACG is where pausedAtStep/subStepCache live;
// each config asserts a measured floor of seeds that hit pending choices.
// ---------------------------------------------------------------------------

interface DriveConfig {
  readonly name: string;
  readonly start: Omit<StartCareerOptions, "seed">;
  /** Ratchet floor: how many non-ledgered seeds must hit ≥1 pending choice.
   *  Values are the counts MEASURED at harness creation (deterministic under
   *  the fixed seed list + driver); a drop below the floor means the
   *  interactive pause path silently stopped firing — investigate, never
   *  lower the floor casually. Seeds below the floor are short runs whose
   *  ACG enlistment throw ended chargen before any prompt could occur. */
  readonly minPendingSeeds: number;
}

const INTERACTIVE = {
  verbose: false,
  interactiveMode: true,
  supportsInteractive: true,
  useAcg: false,
  acgPathway: "",
} as const;

const ACG_PATHWAYS = ["mercenary", "navy", "scout", "merchantPrince"] as const;

const CONFIGS: readonly DriveConfig[] = [
  {
    name: "CT basic",
    start: { ...INTERACTIVE, edition: "ct-classic" },
    minPendingSeeds: 16, // measured 16/20 (cascade prompts are event-driven)
  },
  {
    name: "MT basic",
    start: { ...INTERACTIVE, edition: "mt-megatraveller" },
    minPendingSeeds: 20, // measured 20/20
  },
  ...([
    // mercenary: 6 of the 11 non-ledgered seeds pause (see ledger below —
    // 9 seeds hit the interactive skill-column infinite re-prompt).
    ["mercenary", 6],
    ["navy", 14],  // measured 14/20; the rest fail ACG enlistment at step ~3
    ["scout", 13], // measured 13/20; ditto, plus one prompt-free 1-term run
    ["merchantPrince", 16], // measured 16/18 non-ledgered seeds
  ] as const).map(([pathway, minPendingSeeds]): DriveConfig => ({
    name: `MT ACG ${pathway}`,
    start: {
      ...INTERACTIVE, edition: "mt-megatraveller", useAcg: true, acgPathway: pathway,
    },
    minPendingSeeds,
  })),
];

const SEEDS_PER_CONFIG = 20;
const SEEDS = Array.from({ length: SEEDS_PER_CONFIG }, (_, i) => i + 1);
/** Sampled k values per RunLog for the prefix-consistency property. */
const PREFIX_SAMPLES = 3;
/** Driver safety cap; a healthy run terminates well under it. */
const MAX_STEPS = 500;

// ---------------------------------------------------------------------------
// Divergence ledger. A failing (config, seed) is isolated here rather than
// fixed in the engine or hidden by a weakened assertion: both test loops
// skip it and an it.todo names the diverging field so the drift stays
// visible in the test report until the engine bug is fixed.
// ---------------------------------------------------------------------------

interface KnownDivergence {
  readonly config: string;
  readonly seed: number;
  /** P1..P4 per the property list above; "drive" = the live interactive
   *  drive itself crashed or never terminated, so no RunLog exists. */
  readonly property: "P1" | "P2" | "P3" | "P4" | "drive";
  readonly field: string;
}

// Engine bug 1 — interactive mercenary infinite skill-column re-prompt.
// applyOnce(ch, "skills-applied", fn) marks `applied` only AFTER fn returns
// (subStepCache.ts), but rollMercenarySkill (pathways/mercenary.ts) calls
// pickOrDefer inside fn, which THROWS ChoicePendingError. The resolve closure
// rolls a skill, resolvePending resumes runAcgYear, runPhases re-enters the
// skills phase (never marked applied) and re-queues the identical
// "Choose a service-skills column to roll on" choice — forever, awarding a
// skill per resolve. Reachable in the UI by any interactive-mode mercenary
// with >1 eligible column (Marines, NCOs, officers).
const MERC_SKILL_LOOP =
  'non-termination: skillTable "Choose a service-skills column to roll on" re-queued ' +
  'forever (applyOnce("skills-applied") never marked — pickOrDefer throws first)';

// Engine bug 2 — merchantPrince special-duty transfer with null target:
// applyMerchantSpecialDutyResult does to.toLowerCase() on transfer[1] = null
// (pathways/merchantPrince.ts:685).
// Engine bug 3 — merchantPrince "Fledgling" line with department "Free
// Trader" has no resolution sub-table (key "freeTrader"), so
// merchantResolveAssignment throws mid-year.
const KNOWN_DIVERGENCES: readonly KnownDivergence[] = [
  ...[1, 3, 4, 5, 7, 11, 13, 15, 17].map((seed): KnownDivergence => ({
    config: "MT ACG mercenary", seed, property: "drive", field: MERC_SKILL_LOOP,
  })),
  {
    config: "MT ACG merchantPrince", seed: 7, property: "drive",
    field: "crash: applyMerchantSpecialDutyResult — transfer target null, " +
      "to.toLowerCase() TypeError (merchantPrince.ts:685)",
  },
  {
    config: "MT ACG merchantPrince", seed: 11, property: "drive",
    field: 'crash: no resolution sub-table for department "Free Trader" ' +
      '(key "freeTrader", lineType "Fledgling")',
  },
];

// ---------------------------------------------------------------------------
// Seed-derived action driver. Mirrors exactly the actions the UI can issue in
// each phase (see PreCareerPhase/CareerPhase/AcgEnlistPhase/TermPhase/
// SkillPhase/MusterPhase) and records them into a RunLog.
// ---------------------------------------------------------------------------

/** Pre-career schools the UI would offer right now — mirrors the gating in
 *  app/components/phases/PreCareerPhase.tsx (attempted-school removal, PM
 *  p. 47 honors gates, per-pathway academy availability). */
function legalPreCareerSchools(c: Character): PreCareerOption[] {
  const acg = c.acgState;
  const attended = acg?.schoolsAttended ?? [];
  const attempted = acg?.schoolsAttempted ?? [];
  const honors = acg?.honorsGraduations ?? [];
  const pathway = c.acgPathway ?? "";
  const has = (k: string) => attended.includes(k);
  const tried = (k: string) => attempted.includes(k);
  const hasHonors = (k: string) => honors.includes(k);
  const commissioned = acg?.preCareerCommission === true;
  const schools: PreCareerOption[] = [];
  if (!tried("college") && isPreCareerEligible(c, "college")) schools.push("college");
  if ((pathway === "mercenary" || pathway === "navy") &&
      !tried("navalAcademy") && isPreCareerEligible(c, "navalAcademy")) {
    schools.push("navalAcademy");
  }
  if (pathway === "mercenary" &&
      !tried("militaryAcademy") && isPreCareerEligible(c, "militaryAcademy")) {
    schools.push("militaryAcademy");
  }
  if (!tried("medicalSchool") &&
      (hasHonors("college") || hasHonors("navalAcademy") || hasHonors("militaryAcademy")) &&
      isPreCareerEligible(c, "medicalSchool")) {
    schools.push("medicalSchool");
  }
  if (!tried("flightSchool") &&
      ((hasHonors("college") && commissioned) || has("navalAcademy") ||
       (has("merchantAcademy") && commissioned)) &&
      isPreCareerEligible(c, "flightSchool")) {
    schools.push("flightSchool");
  }
  return schools;
}

const ENLIST_DEFAULTS: EnlistOptions = {
  verbose: false,
  preferredService: "random",
  acgService: "army",
  acgCombatArm: "Infantry",
  acgFleet: "imperialNavy",
  acgDivision: "field",
  acgLineType: "Free Trader",
  acgSubsectorTech: "",
  acgMerchantAcademy: false,
};

/** Basic chargen enlist: seed-derived preferred service (or "random"). */
function basicEnlistOptions(c: Character, rng: Rng): EnlistOptions {
  const pool = ["random", ...getEnlistableServices(c.editionId)];
  return { ...ENLIST_DEFAULTS, preferredService: rng.pick(pool) };
}

/** ACG enlist: seed-derived sub-options for the character's CURRENT pathway
 *  (pre-career academy honors may have redirected it — the form derives from
 *  character.acgPathway, so the driver does too). Option sets mirror
 *  AcgEnlistPhase.tsx. */
function acgEnlistOptions(c: Character, rng: Rng): EnlistOptions {
  const opts: EnlistOptions = { ...ENLIST_DEFAULTS };
  switch (c.acgPathway) {
    case "mercenary": {
      opts.acgService = rng.pick(["army", "marines"] as const);
      const merc = getAcgPathway(c.editionId, "mercenary");
      const gated = new Set(Object.keys(merc?.combatArmEligibility?.armGates ?? {}));
      const arms = (merc?.combatArms ?? []).filter((a) => !gated.has(a));
      if (arms.length > 0) opts.acgCombatArm = rng.pick(arms);
      break;
    }
    case "navy":
      opts.acgFleet = rng.pick(
        ["imperialNavy", "reserveFleet", "systemSquadron"] as const,
      );
      opts.acgSubsectorTech = rng.pick(
        ["", "Early Stellar", "Avg Stellar", "High Stellar"],
      );
      break;
    case "scout":
      opts.acgDivision = rng.pick(["field", "bureaucracy"] as const);
      break;
    case "merchantPrince":
      opts.acgLineType = rng.pick(
        ["Megacorp", "Sector-wide", "Subsector-wide", "Interface", "Fledgling", "Free Trader"],
      );
      if (opts.acgLineType === "Megacorp" || opts.acgLineType === "Sector-wide") {
        opts.acgMerchantAcademy = rng.int(0, 1) === 1;
      }
      break;
    default: break;
  }
  return opts;
}

/** Pick the next action for the current snapshot. A pending player choice
 *  always wins, resolved by a seed-derived option index. Throws on any phase
 *  it doesn't expect so a flow regression surfaces loudly. */
function nextAction(
  snap: ChargenSnapshot, rng: Rng, musterAfterTerms: number, schoolAttempts: number,
): ChargenAction {
  const c = snap.character;
  if (c.pendingChoices.length > 0) {
    const options = c.pendingChoices[0]!.options;
    return { type: "resolve", optionIdx: rng.int(0, options.length - 1) };
  }
  switch (snap.phase) {
    case "pre_career": {
      // At most two school attempts per run keeps the phase bounded; the
      // schoolsAttempted record makes the legal set shrink monotonically.
      const schools = schoolAttempts >= 2 ? [] : legalPreCareerSchools(c);
      const pick = rng.int(0, schools.length);
      // NOTE: ChargenAction's preCareer option type omits "skip" although
      // session.applyPreCareer accepts (and the UI issues) it — a RunLog
      // cannot represent a skip without this cast. Type gap to fix in the
      // resume-model rewrite; runtime replay handles "skip" correctly.
      const option = (pick === schools.length ? "skip" : schools[pick]!) as PreCareerOption;
      return { type: "preCareer", option };
    }
    case "career": return { type: "enlist", opts: basicEnlistOptions(c, rng) };
    case "acg_enlist": return { type: "enlist", opts: acgEnlistOptions(c, rng) };
    case "term":
      // Voluntary muster-out after the seed-derived target terms (mirrors
      // TermPhase's canMusterOut gate); otherwise serve another term.
      if (!c.mandatoryReenlistment && c.terms >= musterAfterTerms) {
        return { type: "attemptMusterOut" };
      }
      return { type: "runTerm" };
    case "skill_basic": return { type: "pickSkill", table: rng.int(0, 3) };
    case "skill_adv": return { type: "pickSkill", table: rng.int(0, 4) };
    case "muster":
      return { type: "musterChoice", kind: rng.int(0, 1) === 0 ? "cash" : "benefit" };
    case "muster_no_cash": return { type: "musterChoice", kind: "benefit" };
    default: throw new Error(`equivalence driver: unexpected phase "${snap.phase}"`);
  }
}

interface Driven {
  /** Final snapshot of the driven (live-path) run. */
  snapshot: ChargenSnapshot;
  /** The replayable record of exactly the actions that were applied. */
  log: RunLog;
  /** True if at least one pending choice was resolved while driving — the
   *  interactive pause/resume path was genuinely exercised. */
  sawPending: boolean;
}

/** Drive one (config, seed) run to a terminal phase, recording each action.
 *  The driver PRNG is decorrelated from the character's stream (different
 *  seed constant) so driver decisions never mirror engine draws. */
function drive(config: DriveConfig, seed: number): Driven {
  const rng = new Rng((seed ^ 0x9e3779b9) >>> 0);
  const musterAfterTerms = rng.int(2, 4);
  const start: StartCareerOptions = { ...config.start, seed };
  const actions: ChargenAction[] = [];
  let snap = startCareer(start);
  let sawPending = false;
  let schoolAttempts = 0;
  for (let step = 0; step < MAX_STEPS && snap.phase !== "end"; step++) {
    const action = nextAction(snap, rng, musterAfterTerms, schoolAttempts);
    if (action.type === "resolve") sawPending = true;
    if (action.type === "preCareer" && (action.option as string) !== "skip") schoolAttempts++;
    actions.push(action);
    snap = applyChargenAction(snap, action);
  }
  return { snapshot: snap, log: { seed, start, actions }, sawPending };
}

/** Driven runs are pure functions of (config, seed); memoized so the property
 *  and coverage tests share one drive per pair. */
const drivenCache = new Map<string, Driven>();
function drivenFor(config: DriveConfig, seed: number): Driven {
  const key = `${config.name}#${seed}`;
  let d = drivenCache.get(key);
  if (d === undefined) {
    d = drive(config, seed);
    drivenCache.set(key, d);
  }
  return d;
}

// ---------------------------------------------------------------------------
// Comparator. Everything observable a faithful re-execution must reproduce,
// including the full acgState (pure data — resume fields, caches, records)
// and mid-run pending-choice surfaces (needed by the prefix property).
//
// Exclusions: the Rng object (its POSITION is asserted separately by the
// RNG-stream property), pendingChoice ids (minted from a module counter that
// deliberately regenerates per run), onResolve closures and free-form choice
// `context` (non-comparable), and renderHistory output (derived verbatim from
// the `events` array, which IS compared).
// ---------------------------------------------------------------------------

function observableState(snap: ChargenSnapshot) {
  const c = snap.character;
  return {
    phase: snap.phase,
    name: c.name,
    gender: c.gender,
    age: c.age,
    apparentAge: c.apparentAge,
    homeworld: c.homeworld,
    attributes: c.attributes,
    skills: [...c.skills].sort((a, b) => a[0].localeCompare(b[0])),
    skillPoints: c.skillPoints,
    service: c.service,
    drafted: c.drafted,
    commissioned: c.commissioned,
    rank: c.rank,
    terms: c.terms,
    shortTermsCount: c.shortTermsCount,
    credits: c.credits,
    retirementPay: c.retirementPay,
    benefits: c.benefits,
    ship: c.ship,
    TAS: c.TAS,
    mortgage: c.mortgage,
    bladeBenefit: c.bladeBenefit,
    gunBenefit: c.gunBenefit,
    chargenStatus: c.chargenStatus,
    showHistory: c.showHistory,
    muster: { ...c.muster },
    anagathics: { ...c.anagathics },
    useAcg: c.useAcg,
    acgPathway: c.acgPathway,
    acgState: c.acgState,
    pendingChoices: c.pendingChoices.map((p) => ({
      kind: p.kind, label: p.label, options: p.options, preferred: p.preferred,
    })),
    events: c.events,
  };
}

/** Three draws from a CLONE of the character's rng — proves the live and
 *  replayed streams sit at the identical position without disturbing the
 *  originals. */
function rngTriple(c: Character): [number, number, number] {
  const r = c.rng.clone();
  return [r.next(), r.next(), r.next()];
}

function prefixLog(log: RunLog, k: number): RunLog {
  const actions = log.actions.slice(0, k);
  return { ...log, actions };
}

/** Sample up to `want` distinct action indices in [0, n). */
function sampleKs(rng: Rng, n: number, want: number): number[] {
  if (n === 0) return [];
  const ks = new Set<number>();
  const target = Math.min(want, n);
  while (ks.size < target) ks.add(rng.int(0, n - 1));
  return [...ks].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// The suite.
// ---------------------------------------------------------------------------

describe("chargen live-vs-replay equivalence properties", () => {
  for (const config of CONFIGS) {
    describe(config.name, () => {
      it(`terminates and exercises the pause path (${SEEDS_PER_CONFIG} seeds)`, () => {
        const pendingSeeds: number[] = [];
        let tested = 0;
        for (const seed of SEEDS) {
          const diverged = KNOWN_DIVERGENCES.some(
            (d) => d.config === config.name && d.seed === seed,
          );
          if (diverged) continue; // tracked by the it.todo below
          tested++;
          const driven = drivenFor(config, seed);
          const tag = `${config.name} seed ${seed}`;
          expect(
            driven.snapshot.phase,
            `${tag}: run did not reach "end" within ${MAX_STEPS} actions`,
          ).toBe("end");
          // Guard the harness itself: an unseeded stream would draw from
          // Math.random and turn every property below into noise.
          expect(driven.snapshot.character.rng.seeded, `${tag}: rng lost its seed`).toBe(true);
          if (driven.sawPending) pendingSeeds.push(seed);
        }
        // A ledger typo must not silently shrink the sample to nothing.
        expect(tested, "ledger must not swallow the whole seed list").toBeGreaterThanOrEqual(10);
        // The interactive pause/resume path under audit must be genuinely
        // exercised: at least the measured number of seeds hit a pending
        // choice (see minPendingSeeds — a drop means the pause path died).
        expect(
          pendingSeeds.length,
          `pause path exercised by [${pendingSeeds.join(",")}] — below the measured floor`,
        ).toBeGreaterThanOrEqual(config.minPendingSeeds);
      });

      it(`holds P1 determinism, P2 live≡replay, P3 prefix, P4 rng-stream (${SEEDS_PER_CONFIG} seeds)`, () => {
        for (const seed of SEEDS) {
          const diverged = KNOWN_DIVERGENCES.some(
            (d) => d.config === config.name && d.seed === seed,
          );
          if (diverged) continue; // tracked by the it.todo below
          const driven = drivenFor(config, seed);
          const tag = `${config.name} seed ${seed}`;

          // P1 — determinism: two independent re-executions agree.
          const replay = replayRun(driven.log);
          const replayAgain = replayRun(driven.log);
          expect(observableState(replayAgain), `${tag} [P1 determinism]`)
            .toEqual(observableState(replay));

          // P2 — live ≡ replay: the driven snapshot, which went through the
          // pause/resume machinery step by step, equals pure re-execution.
          expect(observableState(replay), `${tag} [P2 live≡replay]`)
            .toEqual(observableState(driven.snapshot));

          // P4 — RNG-stream integrity: identical stream POSITION, not just
          // identical visible state.
          expect(rngTriple(replayAgain.character), `${tag} [P4 rng determinism]`)
            .toEqual(rngTriple(replay.character));
          expect(rngTriple(replay.character), `${tag} [P4 rng live≡replay]`)
            .toEqual(rngTriple(driven.snapshot.character));

          // P3 — prefix consistency: one recorded action applied on top of a
          // re-derived prefix lands exactly on the re-derived k+1 state.
          const kRng = new Rng((seed + 0x51ed2701) >>> 0);
          for (const k of sampleKs(kRng, driven.log.actions.length, PREFIX_SAMPLES)) {
            const stepped = applyChargenAction(
              replayRun(prefixLog(driven.log, k)), driven.log.actions[k]!,
            );
            const full = replayRun(prefixLog(driven.log, k + 1));
            expect(observableState(full), `${tag} [P3 prefix k=${k}]`)
              .toEqual(observableState(stepped));
            expect(rngTriple(full.character), `${tag} [P3 prefix k=${k} rng]`)
              .toEqual(rngTriple(stepped.character));
          }
        }
      });

      for (const d of KNOWN_DIVERGENCES.filter((x) => x.config === config.name)) {
        it.todo(
          `DIVERGENCE [${d.property}] seed ${d.seed}: ${d.field} ` +
          "— engine drift bug, do not delete this marker without fixing it",
        );
      }
    });
  }
});
