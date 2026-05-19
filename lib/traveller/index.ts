// Public API barrel. Existing callers import from "@/lib/traveller" — that
// path now resolves to this file instead of the old single-file module.

export type {
  AttributeKey,
  Attributes,
  Gender,
  ServiceDef,
  ServiceKey,
  ShowHistory,
  Skill,
} from "./types";

export { rndInt, arnd, roll } from "./random";
export { numCommaSep, intToOrdinal, extendedHex, attrShort } from "./formatting";
export { generateName, generateGender } from "./names";
export {
  BLADES, BOWS, GUNS, VEHICLES, AIRCRAFTS, WATERCRAFTS,
  cascadeBlade, cascadeBow, cascadeGun,
  cascadeVehicle, cascadeAircraft, cascadeServiceAircraft, cascadeWatercraft,
} from "./cascades";
// Character and cloneCharacter are deliberately NOT re-exported here.
// Importing them via the barrel created a TypeScript-server cache pathology
// (the same class type reachable via two paths got mis-identified across
// re-evaluations). Callers must use:
//   import { Character, cloneCharacter } from "@/lib/traveller/character";
export {
  serviceLabel,
  getEditionServices, getEnlistableServices, getDraftServices,
} from "./services";
export {
  DEFAULT_EDITION_ID, getEdition, listEditions,
  type Edition, type EditionMeta,
} from "./editions";
export {
  editionHasAcg, getAcgCommon, getAcgPathway, listAcgPathways,
} from "./engine/acg";
export {
  runAcgTerm, runAcgYear, runAcgReenlist,
} from "./engine/runners/acg";
export type {
  AcgPathwayId, AcgState, AssignmentResolution, ResolutionTarget,
} from "./engine/acg/types";
export {
  benefitDmFor, cashDmFor, maxCashRolls,
} from "./engine/musterDm";
export type { AcgData, AcgPathway } from "./editions/types";
export {
  formatCharacterSheet, formatBenefit, aggregateBenefits,
} from "./sheet";
