// Shared ACG assignment logging. Emits the year's assignment to history (PM
// checklist 6.A.1) and, when the pathway's edition JSON supplies a cited
// `assignmentNarratives` entry for that assignment, a verbose line explaining
// it — so every ACG assignment with a source description narrates itself once.
//
// Called from the runner (the normal per-year roll) AND from the merchant /
// scout transfer branches: a transfer result reroutes to a REAL assignment the
// runner never sees (the pathway resolves it recursively), so that real
// assignment is logged here in its place. Routing results themselves (merchant
// Transfer Up / Transfer Down / Special) are not in any narrative map, so they
// log only the bare assignment line, never a narrative.

import type { Character } from "@/lib/traveller/character";
import { getAcgPathway } from "@/lib/traveller/editions";
import { event as ev } from "@/lib/traveller/history";

/** Log `assignment` for the current ACG term/year, plus its cited narrative
 *  when the active pathway declares one. `opts.retained` marks a retained
 *  (same-as-previous) assignment, matching the runner's prior behaviour. */
export function logAssignment(
  ch: Character, assignment: string, opts?: { retained?: boolean },
): void {
  const acg = ch.acgState;
  ch.log(ev.assignmentRolled(
    assignment, ch.terms + 1, acg?.year, opts?.retained ? true : undefined,
  ));
  const narrative = getAcgPathway(ch.editionId, acg?.pathway)
    ?.assignmentNarratives?.[assignment];
  if (narrative) ch.log(ev.raw(`${assignment}: ${narrative}`, "verbose"));
}
