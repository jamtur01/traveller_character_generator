// Core types and interfaces for the Classic Traveller character generator.
// No runtime values live here — only type definitions — so this file is free
// of circular-import hazards.

import type { Character } from "./character";

/**
 * Union of every service key across every edition. CT uses 18 of these;
 * MT uses 17 (no "other", adds "lawenforcers"). Each edition's services
 * object is a Partial<Record<ServiceKey, ServiceData>> — code that
 * iterates services must use Object.keys(svcMap) rather than this union.
 */
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
  | "nobles"
  | "lawenforcers";

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

/** Discriminated chargen lifecycle state. `shortTermThisTerm` remains a
 *  separate orthogonal flag because it can coexist with active /
 *  retired (anagathics retry failure ends chargen mid-short-term).
 *  Mandatory reenlistment is also orthogonal — it's a pending action,
 *  consumed at the start of the next term. */
export type ChargenStatus =
  | { kind: "active" }
  | { kind: "retired"; reason?: string }
  | { kind: "deceased"; reason?: string }
  | { kind: "mustered" };

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
  /**
   * MT-style explicit "skills per term" count. When undefined, the engine
   * falls back to CT semantics (scouts/CotI-rankless = 2, first term = 2,
   * other terms = 1). When set, the engine uses this directly.
   */
  skillsPerTerm?: number;
}
