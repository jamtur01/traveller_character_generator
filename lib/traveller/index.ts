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
export { Character, cloneCharacter } from "./character";
export {
  s, SERVICES, DRAFT_SERVICES, ENLISTABLE_SERVICES, serviceLabel,
  getEditionServices, getEnlistableServices, getDraftServices,
} from "./services";
export {
  DEFAULT_EDITION_ID, getEdition, listEditions,
  type Edition, type EditionMeta,
} from "./editions";
export {
  editionHasAcg, getAcgCommon, getAcgPathway, listAcgPathways,
} from "./engine/acg";
export type { AcgData, AcgPathway } from "./editions/types";
export {
  formatCharacterSheet, formatBenefit, aggregateBenefits,
} from "./sheet";
