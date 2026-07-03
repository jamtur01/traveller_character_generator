// Deterministic chargen replay. Because every engine draw flows through a
// seeded Character.rng (see random.ts), a whole run is a pure function of its
// seed plus the ordered sequence of player actions. A RunLog captures exactly
// that, so a character can be rebuilt bit-for-bit — the basis for shareable
// "seed + choices" characters, deterministic regression fixtures, and undo.
//
// Choices are recorded by option index, NOT by choice id: ids come from a
// module counter (engine/choices.genChoiceId) and regenerate each run, so
// replay re-applies each recorded index against whatever choice is pending at
// that point — which is itself deterministic under the seed.
//
// This is an ADDITIVE reconstruction layer over the existing session actions;
// it does not replace the live session's interactive pause/resume flags (those
// correctly drive a single in-flight run and don't need to be event-sourced).

import {
  startCareer, applyPreCareer, enlist, resolvePending, runTerm, pickSkill,
  attemptMusterOut, musterChoice, setVerbose,
  type ChargenSnapshot, type StartCareerOptions, type EnlistOptions,
} from "./session";
import type { PreCareerOption } from "@/lib/traveller/engine/acg/preCareer";

/** One recorded chargen action. `resolve` records only the chosen option
 *  index; the pending choice it targets is deterministic under the seed. */
export type ChargenAction =
  | { readonly type: "preCareer"; readonly option: PreCareerOption }
  | { readonly type: "enlist"; readonly opts: EnlistOptions }
  | { readonly type: "runTerm" }
  | { readonly type: "pickSkill"; readonly table: number }
  | { readonly type: "resolve"; readonly optionIdx: number }
  | { readonly type: "attemptMusterOut" }
  | { readonly type: "musterChoice"; readonly kind: "cash" | "benefit" }
  | { readonly type: "setVerbose"; readonly verbose: boolean };

/** A complete, replayable record of a chargen run: the RNG seed plus the
 *  ordered player actions applied to it. */
export interface RunLog {
  readonly seed: number;
  readonly start: StartCareerOptions;
  readonly actions: readonly ChargenAction[];
}

/** Apply one recorded action to a snapshot, returning the next snapshot. */
export function applyChargenAction(
  snap: ChargenSnapshot, action: ChargenAction,
): ChargenSnapshot {
  switch (action.type) {
    case "preCareer": return applyPreCareer(snap, action.option).snapshot;
    case "enlist": return enlist(snap, action.opts);
    case "runTerm": return runTerm(snap);
    case "pickSkill": return pickSkill(snap, action.table);
    case "resolve": {
      const pending = snap.character.pendingChoices[0];
      if (!pending) {
        throw new Error("replay: `resolve` action but no pending choice");
      }
      return resolvePending(snap, pending.id, action.optionIdx);
    }
    case "attemptMusterOut": return attemptMusterOut(snap);
    case "musterChoice": return musterChoice(snap, action.kind);
    case "setVerbose": return setVerbose(snap, action.verbose);
  }
}

/** Deterministically rebuild a chargen snapshot from a seed + action log.
 *  Given the same RunLog, this reproduces the identical character every time. */
export function replayRun(log: RunLog): ChargenSnapshot {
  let snap = startCareer({ ...log.start, seed: log.seed });
  for (const action of log.actions) snap = applyChargenAction(snap, action);
  return snap;
}
