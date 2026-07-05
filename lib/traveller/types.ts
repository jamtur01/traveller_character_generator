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

/** Discriminated chargen lifecycle state. Per PM:
 *  - active: currently serving normally
 *  - shortTerm: this term cut to 2 years by survival failure (PM p. 16);
 *    special-duty + skills still roll, then muster out
 *  - mandatoryReenlist: rolled 12 on reenlistment, must serve another term;
 *    consumed at the start of the next term
 *  - retired / deceased / mustered: terminal states (chargen ended) */
export type ChargenStatus =
  | { kind: "active" }
  | { kind: "shortTerm"; reason?: string }
  | { kind: "mandatoryReenlist" }
  | { kind: "retired"; reason?: string; withPension: boolean }
  | { kind: "deceased"; reason?: string }
  | { kind: "mustered" };

/**
 * Result of a commission/promotion throw. `margin` = roll + DM - target, so
 * a non-negative margin means the throw passed. Callers read `passed` for the
 * outcome and `margin` for MT's "double skill on overshoot by N" bonus
 * (PM p. 17), which keys off the same roll rather than a fresh one.
 */
export interface CheckResult {
  passed: boolean;
  margin: number;
}

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
   * Roll-log / UI label for the position check ("Commission" for TTB, "Position"
   * for CotI). Sourced from the service's `checks.position.label`; consumers
   * fall back to "Commission" when absent. Display-only — the mechanic is
   * identical either way.
   */
  positionLabel?: string;
  /**
   * If true, reverse the reenlistment rule: the character must throw
   * `reenlistThrow` or higher to LEAVE the service before retirement.
   * Used for the Bureaucrats career per CotI.
   */
  inverseReenlist?: boolean;
  ranks: Record<number, string>;
  getServiceSkills: (ch: Character) => string[];
  checkSurvival: (ch: Character) => boolean;
  checkCommission: (ch: Character) => CheckResult;
  checkPromotion: (ch: Character) => CheckResult;
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
