// Coverage LEDGER — the "report unexercised paths" deliverable.
//
// It unions the coverage-universe tags touched across a broad-but-FAST run set
// (tests/_coverageDriver.driveLedgerRunSet), diffs that against the full
// universe (tests/_coverageUniverse.coverageUniverse), dumps a report to
// coverage-report/, and FAILS if any unexercised tag is not covered by the
// documented, reasoned ALLOWLIST below.
//
// Run set (all cheap knobs on the seeded walkers — never a forced outcome; see
// tests/_coverageDriver.LEDGER_PARAMS):
//   - the 76 coverageMatrix() combos x per-model base seeds (60 classic/acg, a
//     moderate 21 mongoose — seeded dice → the full terminal spread: deaths,
//     short musters, denied reenlistments, washouts);
//   - classic Cash + long-term Benefit muster walks x 50 seeds (the walkers only
//     ever roll Benefit, and rank-5+ characters land the +1 muster-DM row 7);
//   - choice-index fuzzing: the same seeded streams re-driven with drainChoices
//     picks 1..6 (non-first cascade members / career assignments the pick-0
//     walkers never choose);
//   - cheap enumeration: pre-career x each school, mongoose maxCareers=2, and
//     targeted MT-barbarians walks on primitive-homeworld seeds (barbarians is
//     homeworld-gated, ~0.1% of worldgen — reachable, so covered not hidden).
// Every generated character is validated with assertCharacterConsistent.
//
// The allowlist is MINIMAL: everything cheaply reachable is exercised, so only
// engine-terminal-by-design and genuinely dice/rarity-gated tail paths remain.
// Teeth come in two layers: (1) any unexercised tag matching NO rule fails the
// subset assertion; (2) the per-namespace coverage floors prove each namespace
// is broadly hit, so a class rule can never mask a namespace-wide regression.

import { beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { coverageUniverse, type TagMeta } from "@/tests/_coverageUniverse";
import { touchedTags } from "@/tests/_coverageRecorder";
import { driveLedgerRunSet, LEDGER_PARAMS, type LedgerRunStats } from "@/tests/_coverageDriver";
import { assertCharacterConsistent } from "@/tests/_characterInvariants";

interface AllowRule {
  readonly id: string;
  readonly reason: string;
  readonly match: (tag: string, meta: TagMeta) => boolean;
}

// The ONLY paths permitted to stay unexercised. Each is a rule with a written
// reason; a rule matches a tag by value or namespace. Adding a rule widens what
// may go uncovered, so keep it tight and honest.
const ALLOWLIST: readonly AllowRule[] = [
  {
    id: "mongoose-no-death-terminal",
    reason:
      "Mongoose has no chargen death and never logs a 'retired' terminal — the model ends " +
      "only via muster-out (endGeneration 'mustered'), so outcome:mongoose:deceased and " +
      "outcome:mongoose:retired are unreachable by engine design.",
    match: (tag) => tag === "outcome:mongoose:deceased" || tag === "outcome:mongoose:retired",
  },
  {
    id: "acg-death-rare-not-forced",
    reason:
      "The only ACG death is the court-martial death-sentence (BP-gated, statistically rare) " +
      "plus the ageing crisis (needs many terms); ACG survival never kills (every " +
      "endChargenOnFail is 'retired'). Engine-reachable, not force-driven under N seeds.",
    match: (tag) => tag === "outcome:acg:deceased",
  },
  {
    id: "muster-row-dice-gated",
    reason:
      "A muster row is landed only when (1D roll + muster DM) equals it: row 7 needs a +1 DM " +
      "(Gambling for cash, rank 5+ for benefit) and the rest depend on the exact roll — pure " +
      "dice-gated, engine-reachable, statistically rare even under the raised Cash+Benefit " +
      "walks. NOT a coverage hole: every muster cell of every service (rows 1-7, both columns) " +
      "is exhaustively correctness-checked by tests/data.validation.test.ts's forceD6 cell " +
      "sweep — here they are simply not all walk-driven (the muster.* floors below have teeth).",
    match: (_tag, meta) => meta.ns === "muster.cash" || meta.ns === "muster.benefit",
  },
  {
    id: "cascade-leaf-rare",
    reason:
      "A cascade member is landed only when its cascade skill is rolled AND that member index " +
      "is drained; rare cascade skills (archaic weapons, field artillery, technical) and " +
      "higher member indices are statistically rare under N seeds + fuzz picks. " +
      "Engine-reachable, not force-driven (the cascade floor below has teeth).",
    match: (_tag, meta) => meta.ns === "cascade",
  },
  {
    id: "mongoose-roll-row-rare",
    reason:
      "Mongoose event (2D) and mishap (1D) rows at the distribution extremes (roll 2 / 12) " +
      "and forced-only careers (prisoner, entered only by draft/mishap) are statistically " +
      "rare under N seeds. Dice-gated, engine-reachable, not force-driven.",
    match: (_tag, meta) => meta.ns === "mgt.event" || meta.ns === "mgt.mishap",
  },
  {
    id: "mongoose-forced-only-prisoner-assignment",
    reason:
      "Prisoner is a forced-only career (entered only by draft/mishap, never voluntary " +
      "enlistment), so its per-assignment tags are rarely reached under N seeds. " +
      "Engine-reachable, not force-driven.",
    match: (tag, meta) => meta.ns === "mgt.assignment" && tag.includes(":prisoner:"),
  },
];

interface Ledger {
  universe: Map<string, TagMeta>;
  hits: Map<string, number>;
  touched: Set<string>;
  unexercised: string[];
  nsTouched: Map<string, number>;
  nsTotal: Map<string, number>;
  stats: LedgerRunStats;
  failures: string[];
  elapsedMs: number;
}

const REPORT_DIR = join(process.cwd(), "coverage-report");

function buildLedger(): Ledger {
  const universe = coverageUniverse();
  const hits = new Map<string, number>();
  const failures: string[] = [];
  const start = Date.now();
  const stats = driveLedgerRunSet((ch, label) => {
    try {
      assertCharacterConsistent(ch);
    } catch (e) {
      failures.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const tag of touchedTags(ch)) hits.set(tag, (hits.get(tag) ?? 0) + 1);
  });
  const elapsedMs = Date.now() - start;
  const touched = new Set(hits.keys());
  const unexercised: string[] = [];
  const nsTouched = new Map<string, number>();
  const nsTotal = new Map<string, number>();
  for (const [tag, meta] of universe) {
    nsTotal.set(meta.ns, (nsTotal.get(meta.ns) ?? 0) + 1);
    if (touched.has(tag)) nsTouched.set(meta.ns, (nsTouched.get(meta.ns) ?? 0) + 1);
    else unexercised.push(tag);
  }
  return { universe, hits, touched, unexercised, nsTouched, nsTotal, stats, failures, elapsedMs };
}

function writeReport(l: Ledger): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  const hitsObj: Record<string, number> = {};
  for (const tag of [...l.universe.keys()].sort()) hitsObj[tag] = l.hits.get(tag) ?? 0;
  const coverage = {
    generatedBy: "tests/coverageLedger.test.ts",
    params: LEDGER_PARAMS,
    universeSize: l.universe.size,
    touched: l.touched.size,
    unexercised: l.unexercised.length,
    coveragePct: Number(((l.touched.size / l.universe.size) * 100).toFixed(2)),
    driven: l.stats.driven,
    walkSkips: l.stats.walkSkips,
    elapsedMs: l.elapsedMs,
    hits: hitsObj,
  };
  writeFileSync(join(REPORT_DIR, "coverage.json"), `${JSON.stringify(coverage, null, 2)}\n`);
  writeFileSync(join(REPORT_DIR, "unexercised.txt"), formatUnexercised(l));
}

function formatUnexercised(l: Ledger): string {
  const byNs = new Map<string, string[]>();
  for (const tag of l.unexercised) {
    const meta = l.universe.get(tag)!;
    const rule = ALLOWLIST.find((r) => r.match(tag, meta));
    const group = byNs.get(meta.ns) ?? byNs.set(meta.ns, []).get(meta.ns)!;
    group.push(`  ${tag}  [${rule ? rule.id : "UNLISTED!"}]  ${meta.label}`);
  }
  const out = [
    `# Unexercised coverage paths: ${l.unexercised.length} of ${l.universe.size} ` +
      `(${((l.touched.size / l.universe.size) * 100).toFixed(2)}% covered, driven=${l.stats.driven})`,
    "# Each entry maps to an allowlist rule in tests/coverageLedger.test.ts.",
    "",
  ];
  for (const ns of [...byNs.keys()].sort()) {
    const lines = byNs.get(ns)!;
    out.push(`## ${ns} (${lines.length})`, ...lines.sort(), "");
  }
  out.push("# Allowlist rules:");
  for (const r of ALLOWLIST) out.push(`#   ${r.id}: ${r.reason}`);
  return `${out.join("\n")}\n`;
}

let L: Ledger;

// Namespaces whose EVERY tag the run set must reach — structural / player-choice
// paths with no dice gate. A drop here is a real regression (no allowlist rule
// covers them, so the subset assertion also fails).
const FULLY_COVERED_NS = [
  "svc", "mgt.career", "precareer", "edition", "model",
  "acg.pathway", "acg.fleet", "acg.division", "acg.lineType", "acg.combatArm",
] as const;

// Broad-coverage floors for the dice-gated namespaces the residual allowlist
// rules span — teeth so a class rule can't mask a namespace-wide recording
// regression. Each sits comfortably below the measured touched count (reported
// in the ledger). skilltable is absent by design: the recorder now derives a
// table tag from attribute-only rolls too (attributeChange.source), so every
// skill table is walk-reached, its allowlist rule is gone, and any gap fails the
// subset assertion directly — a harder tooth than a floor.
const NS_FLOOR: Record<string, number> = {
  "cascade": 150, "muster.cash": 210, "muster.benefit": 200,
  "mgt.event": 130, "mgt.mishap": 70, "mgt.assignment": 37,
};

describe("coverage ledger — report + fail on any non-allowlisted unexercised path", () => {
  // buildLedger drives ~23k seeded walks (~5s local, ~20s on a slow CI runner),
  // so this hook needs a ceiling well above vitest's 10s default hookTimeout.
  beforeAll(() => {
    L = buildLedger();
    writeReport(L);
  }, 120_000);

  it("drives the full run set with no runaway walks and no inconsistent character", () => {
    expect(L.failures).toEqual([]);
    expect(L.stats.walkSkips).toBe(0);
    expect(L.stats.driven).toBeGreaterThan(8000);
  });

  it("every unexercised tag is covered by a reasoned allowlist rule", () => {
    const violations = L.unexercised.filter(
      (tag) => !ALLOWLIST.some((r) => r.match(tag, L.universe.get(tag)!)),
    );
    expect(violations).toEqual([]);
  });

  it("anti-theatre: touched is large and every element kind is represented", () => {
    const has = (t: string): boolean => L.touched.has(t);
    const hasPrefix = (p: string): boolean => [...L.touched].some((t) => t.startsWith(p));
    expect(L.touched.size).toBeGreaterThan(1000);
    // service model: enlistable, draft-reached, AND the homeworld-gated barbarians
    expect(has("svc:ct-classic:navy")).toBe(true);
    expect(has("svc:mt-megatraveller:barbarians")).toBe(true);
    expect(hasPrefix("skilltable:ct-classic:army:")).toBe(true);
    expect(hasPrefix("cascade:ct-classic:")).toBe(true);
    expect(hasPrefix("cascade:mt-megatraveller:")).toBe(true);
    // ACG: pre-career + pathway + each role decision kind
    expect(has("precareer:mt-megatraveller:college")).toBe(true);
    expect(has("acg.pathway:mt-megatraveller:navy")).toBe(true);
    expect(has("acg.combatArm:mt-megatraveller:Infantry")).toBe(true);
    expect(hasPrefix("acg.fleet:mt-megatraveller:")).toBe(true);
    expect(hasPrefix("acg.division:mt-megatraveller:")).toBe(true);
    expect(hasPrefix("acg.lineType:mt-megatraveller:")).toBe(true);
    // mongoose: career + assignment + event
    expect(has("mgt.career:mongoose-2e:scout")).toBe(true);
    expect(hasPrefix("mgt.assignment:mongoose-2e:scout:")).toBe(true);
    expect(hasPrefix("mgt.event:mongoose-2e:")).toBe(true);
    // muster: BOTH columns actually rolled
    expect(hasPrefix("muster.benefit:")).toBe(true);
    expect(hasPrefix("muster.cash:")).toBe(true);
    // outcomes: CT survival death + ACG washout(retired) + the mustered terminals
    expect(has("outcome:classic:deceased")).toBe(true);
    expect(has("outcome:acg:retired")).toBe(true);
    expect(has("outcome:classic:mustered")).toBe(true);
    expect(has("outcome:mongoose:mustered")).toBe(true);
  });

  it("anti-theatre: structural namespaces fully covered, dice-gated ones above floor", () => {
    for (const ns of FULLY_COVERED_NS) {
      expect(L.nsTouched.get(ns) ?? 0, `namespace ${ns} not fully exercised`).toBe(L.nsTotal.get(ns) ?? -1);
    }
    for (const [ns, floor] of Object.entries(NS_FLOOR)) {
      expect(L.nsTouched.get(ns) ?? 0, `namespace ${ns} below coverage floor`).toBeGreaterThanOrEqual(floor);
    }
  });
});
