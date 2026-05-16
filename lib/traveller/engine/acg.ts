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

/**
 * Map an ACG pathway to the base service the runtime engine uses for the
 * term loop. This is a deliberate simplification: full MT ACG has its own
 * skill tables, branch assignments, MOS, etc., which we don't yet
 * implement. Until that runtime is built, ACG characters reuse the basic
 * service mechanics with ACG state (pathway/branch/MOS/decorations/brownie
 * points) recorded on the side for the ACG record sheet.
 *
 *   mercenary       → army (default) — mercenaries are predominantly army
 *   navy            → navy
 *   scout           → scouts
 *   merchantPrince  → merchants
 *
 * Editions that want finer-grained pathway-to-service mapping should
 * extend this function.
 */
export function pathwayBaseService(pathway: string): string {
  switch (pathway) {
    case "mercenary": return "army";
    case "navy": return "navy";
    case "scout": return "scouts";
    case "merchantPrince": return "merchants";
    default:
      throw new Error(`Unknown ACG pathway "${pathway}"`);
  }
}
