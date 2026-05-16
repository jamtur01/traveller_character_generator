// Core types and interfaces for the Classic Traveller character generator.
// No runtime values live here — only type definitions — so this file is free
// of circular-import hazards.

import type { Character } from "./character";

export type ServiceKey =
  | "navy"
  | "marines"
  | "army"
  | "scouts"
  | "merchants"
  | "pirates"
  | "other"
  | "belters"
  | "sailors"
  | "diplomats"
  | "doctors"
  | "flyers"
  | "barbarians"
  | "bureaucrats"
  | "rogues"
  | "scientists"
  | "hunters"
  | "nobles";

export type AttributeKey =
  | "strength"
  | "dexterity"
  | "endurance"
  | "intelligence"
  | "education"
  | "social";

export type Attributes = Record<AttributeKey, number>;

export type Skill = [string, number];

export type Gender = "male" | "female";

export type ShowHistory = "verbose" | "simple" | "none" | "debug";

export interface ServiceDef {
  serviceName: string;
  memberName: string;
  enlistmentThrow: number;
  enlistmentDM: (a: Attributes) => number;
  survivalThrow: number;
  commissionThrow?: number;
  promotionThrow?: number;
  reenlistThrow: number;
  /**
   * If true, reverse the reenlistment rule: the character must throw
   * `reenlistThrow` or higher to LEAVE the service before retirement.
   * Used for the Bureaucrats career per CotI.
   */
  inverseReenlist?: boolean;
  ranks: Record<number, string>;
  getServiceSkills: (ch: Character) => string[];
  checkSurvival: (ch: Character) => boolean;
  checkCommission: (ch: Character) => boolean;
  checkPromotion: (ch: Character) => boolean;
  doPromotion: (ch: Character) => void;
  musterCash: Record<number, number>;
  musterBenefits: (ch: Character, dm: number) => void;
  acquireSkill: (ch: Character) => void;
}
