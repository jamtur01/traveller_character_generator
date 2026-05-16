// Advanced Character Generation API. MT declares ACG data under
// edition.data.advancedCharacterGeneration; editions without an advanced
// chargen system simply omit the block. The engine exposes these helpers
// so callers (UI, tests, renderer) can ask edition-agnostic questions
// instead of poking into JSON.

import { getEdition } from "../editions";
import type { AcgData, AcgPathway } from "../editions/types";

/** Returns true if the edition declares an advancedCharacterGeneration block. */
export function editionHasAcg(editionId: string): boolean {
  return getEdition(editionId).data.advancedCharacterGeneration !== undefined;
}

/** Returns the named ACG pathways for this edition (excluding the "common"
 *  / "source" / "coverage" meta keys). MT returns
 *  ["mercenary", "navy", "scout", "merchantPrince"]; CT returns []. */
export function listAcgPathways(editionId: string): string[] {
  const acg = getEdition(editionId).data.advancedCharacterGeneration as
    AcgData | undefined;
  if (!acg) return [];
  return Object.keys(acg).filter((k) => k !== "common" && k !== "source" && k !== "coverage");
}

/** Look up one ACG pathway. Throws if the edition has no ACG or the pathway
 *  name isn't declared — same fail-fast pattern as serviceDef(). */
export function getAcgPathway(editionId: string, pathway: string): AcgPathway {
  const acg = getEdition(editionId).data.advancedCharacterGeneration as
    AcgData | undefined;
  if (!acg) {
    throw new Error(`Edition "${editionId}" has no Advanced Character Generation data`);
  }
  const p = acg[pathway];
  if (!p || typeof p !== "object") {
    throw new Error(
      `Edition "${editionId}" has no ACG pathway "${pathway}". Available: ${listAcgPathways(editionId).join(", ") || "(none)"}`,
    );
  }
  return p as AcgPathway;
}

/** Read-only access to the ACG common tables (preCareerOptions,
 *  courtMartial, browniePoints, decorationAndSurvival). Throws if the
 *  edition has no ACG. */
export function getAcgCommon(editionId: string): Record<string, unknown> {
  const acg = getEdition(editionId).data.advancedCharacterGeneration as
    AcgData | undefined;
  if (!acg) {
    throw new Error(`Edition "${editionId}" has no Advanced Character Generation data`);
  }
  return acg.common;
}
