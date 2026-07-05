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

/** The character's current (or most recent) career display name, or "". */
export function currentCareerLabel(ch: Character): string {
  const st = ch.mongooseState;
  const id = st?.career ?? st?.history.at(-1)?.career ?? "";
  return id ? careerLabel(ch, id) : "";
}

/** The character's current assignment display name, or "". */
export function currentAssignmentLabel(ch: Character): string {
  const st = ch.mongooseState;
  if (!st?.career || !st.assignment) return "";
  return assignmentLabel(ch, st.career, st.assignment);
}

/** The rank-ladder TITLE for the character's current rank (e.g. "2nd Officer"),
 *  or null when not in a career or no title is defined at that rank. Mirrors
 *  ranks.ts currentLadder but defensively — display code must not throw. */
export function currentRankTitle(ch: Character): string | null {
  const st = ch.mongooseState;
  if (!st?.career) return null;
  const career = careersOf(ch)?.[st.career];
  if (!career) return null;
  let ladder: readonly MongooseRank[] | undefined;
  if (st.commissioned) {
    ladder = career.ranks.officer;
  } else if (st.assignment) {
    const key = career.ranks.enlistedByAssignment[st.assignment];
    ladder = key ? career.ranks.enlisted[key] : undefined;
  }
  return ladder?.find((r) => r.rank === st.rank)?.title ?? null;
}
