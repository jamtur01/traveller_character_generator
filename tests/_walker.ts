// Workflow walker. Drives a Character through every player decision
// point via the session API, the same way the React UI does. Used by
// tests/workflowWalkthrough.test.ts to detect interactive-mode bugs
// that the existing auto-mode test suite doesn't catch (duplicate log
// events, runaway choice queues, orphaned state).
//
// Each walker returns a WalkResult with the final character + a log of
// significant transitions. Tests assert on these results.

import { vi } from "vitest";
import { Character } from "../lib/traveller/character";
import * as session from "../lib/traveller/chargen/session";

export interface WalkResult {
  character: Character;
  snap: session.ChargenSnapshot;
  /** Choices resolved during the walk, in order. */
  resolved: Array<{ kind: string; pick: number; label: string }>;
  /** Snapshots of character.events.length after each runTerm to detect
   *  duplicate-log regressions (the count should grow strictly). */
  eventCountTrail: number[];
  /** Snapshots of character.terms after each runTerm. */
  termsTrail: number[];
}

/** Force every Math.random call to return a deterministic d6 = `v`. */
export function pinD6(v: number): void {
  vi.spyOn(Math, "random").mockReturnValue((v - 1) / 6 + 0.0001);
}

/** Drain pending choices by picking `pick` (default 0) on each, with a
 *  hard cap to detect runaway queues. */
export function drainChoices(
  snap: session.ChargenSnapshot,
  pick: number = 0,
  resolved: WalkResult["resolved"] = [],
  cap: number = 50,
): session.ChargenSnapshot {
  let cur = snap;
  let n = 0;
  while (cur.character.pendingChoices.length > 0) {
    n++;
    if (n > cap) {
      throw new Error(
        `Runaway choice queue: drained ${cap} choices without exhausting. ` +
        `Pending kinds: ${cur.character.pendingChoices.map((c) => c.kind).join(", ")}`,
      );
    }
    const c = cur.character.pendingChoices[0]!;
    const idx = Math.min(pick, c.options.length - 1);
    resolved.push({ kind: c.kind, pick: idx, label: c.label });
    cur = session.resolvePending(cur, c.id, idx).snapshot;
  }
  return cur;
}

/** Walk a basic chargen (CT or MT, useAcg=false) to muster-out. */
export function walkBasic(opts: {
  edition: "ct-classic" | "mt-megatraveller";
  service: string;
  interactive?: boolean;
  maxTerms?: number;
}): WalkResult {
  pinD6(6);
  const snap0 = session.startCareer({
    edition: opts.edition,
    verbose: true,
    interactiveMode: opts.interactive ?? false,
    supportsInteractive: opts.interactive ?? false,
    useAcg: false,
    acgPathway: "",
  });
  let snap = session.enlist(snap0, {
    verbose: true,
    preferredService: opts.service,
    acgService: "army", acgCombatArm: "Infantry",
    acgFleet: "imperialNavy", acgDivision: "field",
    acgLineType: "Free Trader", acgSubsectorTech: "",
    acgMerchantAcademy: false,
  });
  const resolved: WalkResult["resolved"] = [];
  const eventCountTrail: number[] = [];
  const termsTrail: number[] = [];
  const maxTerms = opts.maxTerms ?? 4;
  for (let i = 0; i < maxTerms; i++) {
    if (snap.phase === "end") break;
    snap = session.runTerm(snap);
    snap = drainChoices(snap, 0, resolved);
    // Pick all skill tables on auto (table 0 = random per UI semantics).
    while (snap.phase === "skill_basic" || snap.phase === "skill_adv") {
      snap = session.pickSkill(snap, 0);
      snap = drainChoices(snap, 0, resolved);
    }
    eventCountTrail.push(snap.character.events.length);
    termsTrail.push(snap.character.terms);
  }
  // Drain muster.
  while (snap.phase === "muster" || snap.phase === "muster_no_cash") {
    snap = session.musterChoice(snap, "benefit");
    snap = drainChoices(snap, 0, resolved);
  }
  return { character: snap.character, snap, resolved, eventCountTrail, termsTrail };
}

/** Back-compat alias. */
export function walkCtBasic(opts: {
  service: string;
  interactive?: boolean;
  maxTerms?: number;
}): WalkResult {
  return walkBasic({ edition: "ct-classic", ...opts });
}

/** Walk an ACG pathway end-to-end via the session API. */
export function walkAcg(opts: {
  pathway: "mercenary" | "navy" | "scout" | "merchantPrince";
  service?: "army" | "marines";
  combatArm?: string;
  fleet?: "imperialNavy" | "reserveFleet" | "systemSquadron";
  division?: "field" | "bureaucracy";
  lineType?: string;
  preCareer?: session.PreCareerOption;
  interactive?: boolean;
  maxTerms?: number;
}): WalkResult {
  pinD6(6);
  const snap0 = session.startCareer({
    edition: "mt-megatraveller",
    verbose: true,
    interactiveMode: opts.interactive ?? false,
    supportsInteractive: true,
    useAcg: true,
    acgPathway: opts.pathway,
  });
  // Pre-career: skip by default; a real option (e.g. "college") ages the
  // character, exercising the stored preCareerAgeYears summand.
  const skipResult = session.applyPreCareer(snap0, opts.preCareer ?? "skip");
  let snap = session.enlist(skipResult.snapshot, {
    verbose: true,
    preferredService: "random",
    acgService: opts.service ?? "army",
    acgCombatArm: opts.combatArm ?? "Infantry",
    acgFleet: opts.fleet ?? "imperialNavy",
    acgDivision: opts.division ?? "field",
    acgLineType: opts.lineType ?? "Free Trader",
    acgSubsectorTech: "",
    acgMerchantAcademy: false,
  });
  const resolved: WalkResult["resolved"] = [];
  const eventCountTrail: number[] = [];
  const termsTrail: number[] = [];
  const maxTerms = opts.maxTerms ?? 4;
  for (let i = 0; i < maxTerms; i++) {
    if (snap.phase === "end") break;
    snap = session.runTerm(snap);
    snap = drainChoices(snap, 0, resolved);
    // ACG doesn't enter skill_basic/skill_adv (those are basic-chargen
    // phases) — its skill rolls happen inside resolveAssignment.
    eventCountTrail.push(snap.character.events.length);
    termsTrail.push(snap.character.terms);
    if (snap.phase !== "term") break;
  }
  while (snap.phase === "muster" || snap.phase === "muster_no_cash") {
    snap = session.musterChoice(snap, "benefit");
    snap = drainChoices(snap, 0, resolved);
  }
  return { character: snap.character, snap, resolved, eventCountTrail, termsTrail };
}

/** Enlist options for the Mongoose flow. The mongoose model reads only
 *  `verbose`; career + assignment + background skills are in-flow choices
 *  (pickOrDefer), so the acg/service fields are inert here. */
const MONGOOSE_ENLIST: session.EnlistOptions = {
  verbose: true,
  preferredService: "random",
  acgService: "army",
  acgCombatArm: "",
  acgFleet: "imperialNavy",
  acgDivision: "field",
  acgLineType: "",
  acgSubsectorTech: "",
  acgMerchantAcademy: false,
};

/** Drain pending Mongoose choices. A `mongooseCareer` prompt is resolved to
 *  the requested `career` id (so a specific career gets attempted) — every
 *  other prompt (assignment, background skill, per-term skill table) takes
 *  option 0. Bounded like drainChoices to catch a runaway queue. */
function drainMongooseChoices(
  snap: session.ChargenSnapshot,
  career: string | undefined,
  resolved: WalkResult["resolved"],
  cap: number = 60,
): session.ChargenSnapshot {
  let cur = snap;
  let n = 0;
  while (cur.character.pendingChoices.length > 0) {
    n++;
    if (n > cap) {
      throw new Error(
        `walkMongoose: runaway choice queue: drained ${cap} choices without ` +
        `exhausting. Pending kinds: ` +
        `${cur.character.pendingChoices.map((c) => c.kind).join(", ")}`,
      );
    }
    const c = cur.character.pendingChoices[0]!;
    let idx = 0;
    if (c.kind === "mongooseCareer" && career !== undefined) {
      const target = c.options.indexOf(career);
      if (target >= 0) idx = target;
    }
    resolved.push({ kind: c.kind, pick: idx, label: c.label });
    cur = session.resolvePending(cur, c.id, idx).snapshot;
  }
  return cur;
}

/** Walk a Mongoose Traveller 2e character to a terminal phase via the session
 *  API — the peer of walkBasic/walkAcg for the mongoose model. Mongoose folds
 *  mustering-out into runTerm/attemptMusterOut (there is no musterChoice
 *  action and no muster phase): "career" = between careers, "term" = in one.
 *
 *  Seed-driven (NOT pinned like walkBasic/walkAcg): a constant Math.random
 *  would roll a natural 12 on every advancement, which the rules (Core p.18)
 *  read as "must remain in this career" — an inescapable loop. A seeded rng
 *  gives varied rolls that terminate, and satisfies the session's determinism
 *  invariant for the interactive re-execution path.
 *
 *  When `career` is set the walk runs interactive and resolves the career
 *  prompt to that id (attempting that specific career); otherwise it runs auto
 *  and takes the model's default career. `maxTerms` caps terms per career and
 *  `maxCareers` caps how many careers are entered before finishing — both keep
 *  the walk bounded. */
export function walkMongoose(opts: {
  career?: string;
  seed?: number;
  interactive?: boolean;
  maxTerms?: number;
  maxCareers?: number;
} = {}): WalkResult {
  const interactive = opts.interactive ?? opts.career !== undefined;
  const snap0 = session.startCareer({
    edition: "mongoose-2e",
    verbose: true,
    interactiveMode: interactive,
    supportsInteractive: true,
    useAcg: false,
    acgPathway: "",
    seed: opts.seed ?? 0x5eed_2e,
  });
  const resolved: WalkResult["resolved"] = [];
  const eventCountTrail: number[] = [];
  const termsTrail: number[] = [];
  const maxTerms = opts.maxTerms ?? 4;
  const maxCareers = opts.maxCareers ?? 1;
  // Safety cap on total session steps: a healthy walk terminates well under it;
  // an over-run means the flow is stuck (e.g. a perpetual "must continue").
  const stepCap = maxCareers * (maxTerms + 8) + 12;
  let snap = snap0;
  let steps = 0;
  while (snap.phase !== "end") {
    steps++;
    if (steps > stepCap) {
      throw new Error(
        `walkMongoose: step cap ${stepCap} exceeded at phase "${snap.phase}" ` +
        `(careerCount=${snap.character.mongooseState?.careerCount ?? "?"}, ` +
        `termsInCareer=${snap.character.mongooseState?.termsInCareer ?? "?"})`,
      );
    }
    const st = snap.character.mongooseState;
    switch (snap.phase) {
      case "career":
        // Between careers: finish once the career cap is met, else enter one more.
        snap = (st?.careerCount ?? 0) >= maxCareers
          ? session.attemptMusterOut(snap)
          : session.enlist(snap, MONGOOSE_ENLIST);
        snap = drainMongooseChoices(snap, opts.career, resolved);
        break;
      case "term": {
        // A natural-12 "must continue" (or unreleased parole) forces another
        // term; otherwise muster out once the per-career term cap is met.
        const mustStay = st?.perTerm.mustContinue ?? false;
        snap = !mustStay && st !== null && st.termsInCareer >= maxTerms
          ? session.attemptMusterOut(snap)
          : session.runTerm(snap);
        snap = drainMongooseChoices(snap, opts.career, resolved);
        eventCountTrail.push(snap.character.events.length);
        termsTrail.push(snap.character.terms);
        break;
      }
      default:
        throw new Error(`walkMongoose: unexpected phase "${snap.phase}"`);
    }
  }
  return { character: snap.character, snap, resolved, eventCountTrail, termsTrail };
}

/** Count repeated consecutive section-separator events (the
 *  "----------" lines). A run > 1 means termBegin duplication. */
export function consecutiveSectionRuns(c: Character): number {
  let max = 0;
  let cur = 0;
  for (const e of c.events) {
    if (e.kind === "section") {
      cur++;
      max = Math.max(max, cur);
    } else if (e.kind === "termBegin") {
      cur = 0;
    } else {
      cur = 0;
    }
  }
  return max;
}

/** Count termBegin events per (terms+1) — should be exactly one per
 *  term entered. */
export function termBeginsPerTerm(c: Character): Map<number, number> {
  const out = new Map<number, number>();
  for (const e of c.events) {
    if (e.kind === "termBegin") {
      out.set(e.termNumber, (out.get(e.termNumber) ?? 0) + 1);
    }
  }
  return out;
}
