// Advanced Character Generation API. MT declares ACG data under
// edition.data.advancedCharacterGeneration; editions without an advanced
// chargen system simply omit the block. The engine exposes these helpers
// so callers (UI, tests, renderer) can ask edition-agnostic questions
// instead of poking into JSON.

import { getEdition } from "@/lib/traveller/editions";
import type { AcgPathway } from "@/lib/traveller/editions/types";
import type { MercenaryData } from "./acg/pathways/mercenary";
import type { NavyData } from "./acg/pathways/navy";
import type { ScoutData } from "./acg/pathways/scout";
import type { MerchantData } from "./acg/pathways/merchantPrince";
import { validateMercenaryConfig } from "./acg/pathways/mercenary";
import { validateNavyConfig } from "./acg/pathways/navy";
import { validateScoutConfig } from "./acg/pathways/scout";
import { validateMerchantConfig } from "./acg/pathways/merchantPrince";

/** Build (and discard) the PathwaySpec for every pathway the edition
 *  declares. Surfaces missing callback names, malformed phase configs,
 *  and unknown preRun hooks at edition load instead of at first ACG
 *  run. No-op if the edition has no ACG data. Idempotency lives in the
 *  edition registry — getEdition gates this on its own first-call set. */
export function validateEditionAcgConfigs(editionId: string): void {
  if (!editionHasAcg(editionId)) return;
  validateMercenaryConfig(editionId);
  validateNavyConfig(editionId);
  validateScoutConfig(editionId);
  validateMerchantConfig(editionId);
}

/** Returns true if the edition declares an advancedCharacterGeneration block. */
export function editionHasAcg(editionId: string): boolean {
  return getEdition(editionId).data.advancedCharacterGeneration !== undefined;
}

/** Returns the named ACG pathways for this edition (excluding the "common"
 *  / "source" / "coverage" meta keys). MT returns
 *  ["mercenary", "navy", "scout", "merchantPrince"]; CT returns []. */
export function listAcgPathways(editionId: string): string[] {
  const acg = getEdition(editionId).data.advancedCharacterGeneration;
  if (!acg) return [];
  return Object.keys(acg).filter((k) => k !== "common" && k !== "source" && k !== "coverage");
}

/** Look up one ACG pathway. Throws if the edition has no ACG or the pathway
 *  name isn't declared — same fail-fast pattern as serviceDef(). The four
 *  string-literal overloads narrow the return type to the pathway's typed
 *  data shape; the generic overload preserves back-compat for callers that
 *  pass a runtime string. */
export function getAcgPathway(editionId: string, pathway: "mercenary"): MercenaryData & AcgPathway;
export function getAcgPathway(editionId: string, pathway: "navy"): NavyData & AcgPathway;
export function getAcgPathway(editionId: string, pathway: "scout"): ScoutData & AcgPathway;
export function getAcgPathway(editionId: string, pathway: "merchantPrince"): MerchantData & AcgPathway;
export function getAcgPathway(editionId: string, pathway: string): AcgPathway;
export function getAcgPathway(editionId: string, pathway: string): AcgPathway {
  const acg = getEdition(editionId).data.advancedCharacterGeneration;
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
  const acg = getEdition(editionId).data.advancedCharacterGeneration;
  if (!acg) {
    throw new Error(`Edition "${editionId}" has no Advanced Character Generation data`);
  }
  return acg.common;
}

// pathwayBaseService removed: ACG runs its own runtime with pathway-
// specific assignment / branch / MOS / school tables; it does not borrow
// basic-service mechanics.
