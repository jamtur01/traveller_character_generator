// Display-label resolvers for Mongoose 2e chargen. The UI/sheet must render the
// JSON's human labels (career/assignment displayName, rank-ladder title) rather
// than the engine's raw ids and rank numbers. These are DISPLAY-ONLY and must
// never throw (unlike ranks.ts currentLadder, which fails loud for the engine):
// a between-careers or partially-built character resolves to a sensible string.

import type { Character } from "@/lib/traveller/character";
import { getEdition } from "@/lib/traveller/editions";
import type { MongooseCareer, MongooseRank } from "@/lib/traveller/engine/mongoose/types";

/** Capitalize a bare id as a last resort (careers/assignments carry a proper
 *  displayName; this only fires on unexpected/missing data). */
const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function careersOf(ch: Character): Record<string, MongooseCareer> | undefined {
  return getEdition(ch.editionId).data.mongoose?.careers;
}

/** JSON displayName for a career id (falls back to a capitalized id). */
export function careerLabel(ch: Character, careerId: string): string {
  return careersOf(ch)?.[careerId]?.displayName ?? cap(careerId);
}

/** JSON displayName for an assignment id within a career. */
export function assignmentLabel(ch: Character, careerId: string, asgId: string): string {
  const a = careersOf(ch)?.[careerId]?.assignments.find((x) => x.id === asgId);
  return a?.displayName ?? cap(asgId);
}

/** The career context to DISPLAY: the live career while one is active, else the
 *  most recent finished career from history. `state.career`/`assignment` are
 *  cleared to null at muster-out, so a completed character's career, assignment,
 *  and final rank survive only in `history` — read them there for the sheet. */
interface EffectiveCareer {
  readonly careerId: string;
  readonly career: MongooseCareer;
  readonly assignment: string | null;
  readonly rank: number;
  readonly commissioned: boolean;
}

function effectiveCareer(ch: Character): EffectiveCareer | null {
  const st = ch.mongooseState;
  if (!st) return null;
  if (st.career) {
    const career = careersOf(ch)?.[st.career];
    if (!career) return null;
    return {
      careerId: st.career, career, assignment: st.assignment,
      rank: st.rank, commissioned: st.commissioned,
    };
  }
  const last = st.history.at(-1);
  if (!last) return null;
  const career = careersOf(ch)?.[last.career];
  if (!career) return null;
  return {
    careerId: last.career, career, assignment: last.assignment,
    rank: last.finalRank, commissioned: last.commissioned,
  };
}

/** The character's current (or most recent) career display name, or "". */
export function currentCareerLabel(ch: Character): string {
  const eff = effectiveCareer(ch);
  return eff ? careerLabel(ch, eff.careerId) : "";
}

/** The character's current (or most recent) assignment display name, or "". */
export function currentAssignmentLabel(ch: Character): string {
  const eff = effectiveCareer(ch);
  return eff?.assignment ? assignmentLabel(ch, eff.careerId, eff.assignment) : "";
}

/** Rank-ladder TITLE for an explicit career/assignment/rank/commissioned tuple
 *  (e.g. "2nd Officer"), or null when the career is unknown or that rung has no
 *  title (rankless careers / untitled rungs — the caller renders a blank, never
 *  "Rank N"). Used for finished-career history records on the sheet. */
export function rankTitleFor(
  ch: Character, careerId: string, assignment: string | null,
  rank: number, commissioned: boolean,
): string | null {
  const career = careersOf(ch)?.[careerId];
  if (!career) return null;
  let ladder: readonly MongooseRank[] | undefined;
  if (commissioned) {
    ladder = career.ranks.officer;
  } else if (assignment) {
    const key = career.ranks.enlistedByAssignment[assignment];
    ladder = key ? career.ranks.enlisted[key] : undefined;
  }
  return ladder?.find((r) => r.rank === rank)?.title ?? null;
}

/** The rank-ladder TITLE for the character's current (or final) rank, reading
 *  the finished career from history when no career is active. Null when there
 *  is no career or no title at that rank (caller renders a blank, never
 *  "Rank N"). Mirrors ranks.ts currentLadder but defensively — must not throw. */
export function currentRankTitle(ch: Character): string | null {
  const eff = effectiveCareer(ch);
  return eff ? rankTitleFor(ch, eff.careerId, eff.assignment, eff.rank, eff.commissioned) : null;
}
