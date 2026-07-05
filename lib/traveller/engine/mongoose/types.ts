// Mongoose Traveller 2e (2022 Core Rulebook) data model. These interfaces
// describe the shape the edition JSON (data/editions/mongoose-2e.json) declares
// for the mongoose chargen model; the engine (engine/mongoose/*) is a pure
// interpreter of this data, per the rules-as-JSON design. Every field is
// sourced from the printed rulebook with a $rule citation in the JSON.
//
// Structure (Core pp.18-21): a career has one Qualification check, three
// Assignments (each with its own Survival + Advancement check and specialist
// skill table), shared Personal Development / Service / Advanced Education skill
// tables (military careers add an Officer table), a Ranks-and-Bonuses ladder,
// a 2D Events table, a 1D Mishaps table, and a 1D Cash / Material-Benefits
// muster table.

/** A 2D + characteristic-DM check. `characteristics` lists the eligible
 *  characteristic keys; the best DM among them is used (Mongoose "X or Y").
 *  An empty list denotes an automatic pass (Drifter qualification). */
export interface MongooseCheck {
  readonly characteristics: readonly string[];
  readonly target: number;
}

/** A skill-table column: index 1-6 (1D). Index 0 is unused (null). Cells carry
 *  a skill name, optionally with a level floor ("Gambler 0", "Streetwise 1");
 *  a bare name means gain-at-1-or-+1. Characteristic boosts read as "DEX +1". */
export type MongooseSkillColumn = readonly (string | null)[];

/** The skill tables shared across a career's assignments. */
export interface MongooseSkillTables {
  readonly personalDevelopment: MongooseSkillColumn;
  readonly serviceSkills: MongooseSkillColumn;
  /** Advanced Education table (1D). Null for careers without one (Drifter). */
  readonly advancedEducation: MongooseSkillColumn | null;
  /** Minimum EDU to roll on the Advanced Education table (usually 8, Citizen/
   *  Scholar 10). Null when the career has no Advanced Education table. */
  readonly advancedEducationEduMin: number | null;
  /** Officer skill table — commissioned military careers only. */
  readonly officer?: MongooseSkillColumn;
}

/** One rung of a career's rank ladder. `benefit` is the skill/characteristic
 *  gained immediately on reaching the rank (null for plain rungs). */
export interface MongooseRank {
  readonly rank: number;
  readonly title: string | null;
  readonly benefit: string | null;
}

/** A career's rank ladders. Enlisted ladders are keyed by ladder id: for
 *  careers where each assignment has its own ladder the key is the assignment
 *  id; where assignments share a ladder (military, or Agent's Intelligence /
 *  Corporate) one ladder covers several assignments. `enlistedByAssignment`
 *  maps every assignment id to the ladder it advances on. Military careers add
 *  a shared `officer` ladder. */
export interface MongooseRanks {
  readonly enlisted: Record<string, readonly MongooseRank[]>;
  readonly enlistedByAssignment: Record<string, string>;
  readonly officer?: readonly MongooseRank[];
}

/** One assignment within a career. */
export interface MongooseAssignment {
  readonly id: string;
  readonly displayName: string;
  readonly survival: MongooseCheck;
  readonly advancement: MongooseCheck;
  /** The assignment's specialist skill table (1D). */
  readonly skills: MongooseSkillColumn;
}

// --- Events & mishaps -------------------------------------------------------

/** One mechanical outcome of an event/mishap. The union covers the outcomes
 *  the printed tables produce; `narrative`-only rows (referee adjudication)
 *  carry no effect and are logged as history. Extended as careers are added. */
export type MongooseEffect =
  | { readonly kind: "gainSkill"; readonly skill: string; readonly level?: number }
  | { readonly kind: "gainSkillChoice"; readonly options: readonly string[]; readonly level?: number }
  | { readonly kind: "modifyCharacteristic"; readonly characteristic: string; readonly delta: number }
  | { readonly kind: "benefitDm"; readonly dm: number; readonly scope: "next" | "any" }
  | { readonly kind: "advancementDm"; readonly dm: number; readonly scope: "next" | "any" }
  | { readonly kind: "gainRelation"; readonly relation: "contact" | "ally" | "rival" | "enemy"; readonly count: string }
  | { readonly kind: "rollMishap"; readonly ejected: boolean }
  | { readonly kind: "rollInjury"; readonly twiceTakeLower: boolean }
  | { readonly kind: "lifeEvent" }
  | { readonly kind: "autoPromote" }
  | { readonly kind: "forceCareer"; readonly career: string }
  | { readonly kind: "leaveCareer"; readonly keepBenefit: boolean }
  | { readonly kind: "gainAnySkill"; readonly level?: number; readonly existingOnly?: boolean }
  | { readonly kind: "modifyCharacteristicChoice"; readonly characteristics: readonly string[]; readonly delta: number }
  | { readonly kind: "autoCommission" }
  | { readonly kind: "benefitRoll"; readonly delta: number }
  | { readonly kind: "stayInCareer" }
  | { readonly kind: "qualificationDm"; readonly dm: number; readonly scope: "next" | "any" }
  | { readonly kind: "survivalDm"; readonly dm: number; readonly scope: "next" | "any" }
  | { readonly kind: "rollDraft" }
  | { readonly kind: "forfeitBenefits" }
  | { readonly kind: "offerCareer"; readonly career: string }
  | { readonly kind: "rollForceCareer"; readonly dice: number; readonly results: readonly number[]; readonly career: string }
  // Player-choice between heterogeneous effect bundles ("gain X or DM+4"; a "may
  // ..." option includes an empty [] branch = decline). One branch is applied.
  | { readonly kind: "chooseEffect"; readonly options: readonly (readonly MongooseEffect[])[] }
  // An embedded skill/characteristic check whose outcome branches into further
  // effects (e.g. Agent event 3: "Roll Investigate 8+ ... on success ...").
  | { readonly kind: "check"; readonly options: readonly string[]; readonly target: number;
      readonly onSuccess: readonly MongooseEffect[]; readonly onFailure: readonly MongooseEffect[] };

/** A 2D Events-table row (roll 2-12) or a 1D Mishaps-table row (roll 1-6). */
export interface MongooseTableRow {
  readonly roll: number;
  readonly text: string;
  readonly effects: readonly MongooseEffect[];
}

// --- Muster ----------------------------------------------------------------

/** A 1D Cash / Material-Benefits muster row (roll 1-7 with the +1-per-... DMs).
 *  `cash` is the credit amount for that row; `benefit` the material benefit. */
export interface MongooseMusterRow {
  readonly roll: number;
  readonly cash: number;
  readonly benefit: string;
}

// --- Career & top-level block ----------------------------------------------

/** One Mongoose career (Core pp.22-45). */
export interface MongooseCareer {
  readonly id: string;
  readonly displayName: string;
  readonly page: number;
  readonly qualification: MongooseCheck;
  /** Commission check target — Army / Navy / Marine only. */
  readonly commission?: MongooseCheck;
  readonly assignments: readonly MongooseAssignment[];
  readonly skillTables: MongooseSkillTables;
  readonly ranks: MongooseRanks;
  readonly events: readonly MongooseTableRow[];
  readonly mishaps: readonly MongooseTableRow[];
  readonly musterOut: readonly MongooseMusterRow[];
}

/** Pre-career education option (University / Military Academy, Core pp.14-16). */
export interface MongoosePreCareer {
  readonly id: string;
  readonly displayName: string;
  readonly qualification: MongooseCheck;
}

/** A characteristic reduction (ageing / injury): reduce `count` characteristics
 *  drawn from `pool` (default the three physical characteristics) by `amount`
 *  — a fixed number or a die string like "1D". */
export interface MongooseReduction {
  readonly count: number;
  readonly amount: number | string;
  readonly pool?: readonly string[];
}

/** Injury table row (Core p.49, 1D). */
export interface MongooseInjuryRow {
  readonly roll: number;
  readonly text: string;
  readonly reductions: readonly MongooseReduction[];
}

/** Ageing table row (Core p.49, 2D - total terms). `threshold` is the modified
 *  value at which the row applies; the engine clamps the roll into range and
 *  looks up the exact threshold. */
export interface MongooseAgingRow {
  readonly threshold: number;
  readonly text: string;
  readonly reductions: readonly MongooseReduction[];
}

/** Benefits of Rank (Core p.46): a rank band grants bonus benefit rolls (and,
 *  at the top band, a DM to all benefit rolls from that career). */
export interface MongooseRankBonus {
  readonly minRank: number;
  readonly maxRank: number;
  readonly bonusRolls: number;
  readonly benefitDm?: number;
}

/** Pension schedule (Core p.49). */
export interface MongoosePensions {
  readonly minTerms: number;
  readonly excludedCareers: readonly string[];
  readonly table: readonly { readonly terms: number; readonly pay: number }[];
  /** Beyond the highest tabulated term, add perTermPay per extra term. */
  readonly beyondTerm: number;
  readonly perTermPay: number;
}

/** The mongoose edition's top-level data block. */
export interface MongooseData {
  /** Starting age (Core p.8: 18). */
  readonly startAge: number;
  /** Term length in years (Core p.11: 4). */
  readonly termLengthYears: number;
  /** Characteristic Modifiers table (Core p.9): score bands -> DM. */
  readonly characteristicDmBands: readonly { readonly min: number; readonly max: number; readonly dm: number }[];
  /** Default task target when a check lists no difficulty (Core p.61: 8). */
  readonly defaultTaskTarget: number;
  /** Background skills granted from adolescence (Core p.10): the count is this
   *  base plus the character's EDU DM, so background skill count = base + EDU
   *  DM (base 3 gives the printed 0-6 range). */
  readonly backgroundSkillBase: number;
  /** Background skill table (Core p.10). */
  readonly backgroundSkills: readonly string[];
  readonly preCareer: readonly MongoosePreCareer[];
  /** Draft table (Core p.20): 1D -> career + assignment. */
  readonly draft: readonly { readonly roll: number; readonly career: string; readonly assignment: string }[];
  readonly careers: Record<string, MongooseCareer>;
  /** Term at whose end ageing rolls begin — term 4 / age 34 (Core p.49). */
  readonly agingStartTerm: number;
  /** Max Cash-column benefit rolls across all careers (Core p.46: 3). */
  readonly cashRollCap: number;
  /** SOC at which a commission may be attempted in any term, not just the
   *  first (Core p.18). */
  readonly commissionAnyTermSocMin: number;
  /** Max skill level during creation (Core p.19: 4). */
  readonly skillLevelMax: number;
  /** Total skill-level cap: multiplier x sum of the named attributes (Core
   *  p.19: 3 x (INT + EDU)). */
  readonly skillTotalCap: { readonly multiplier: number; readonly attributes: readonly string[] };
  /** Benefits of Rank bonus-roll bands (Core p.46). */
  readonly benefitsOfRank: readonly MongooseRankBonus[];
  /** Pension schedule (Core p.49). */
  readonly pensions: MongoosePensions;
  /** Injury table (Core p.49, 1D). */
  readonly injury: readonly MongooseInjuryRow[];
  /** Ageing table (Core p.49, 2D - total terms). */
  readonly aging: readonly MongooseAgingRow[];
  /** Life Events table (Core p.46, 2D) — the event-7 target; uses the shared
   *  effect union. */
  readonly lifeEvents: readonly MongooseTableRow[];
  /** Unusual Event sub-table (Core p.46, 1D on a Life Event of 12). */
  readonly lifeEventsUnusual: readonly MongooseTableRow[];
}
