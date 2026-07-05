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
  /** Qualification-only (Core p.24/32/36): a negative DM applied when the
   *  Traveller is at least `minAge` on entry (Army/Marine 30+, Navy 34+). */
  readonly ageDm?: { readonly minAge: number; readonly dm: number };
  /** Qualification-only (Core p.38 Noble): automatic qualification with no roll
   *  when the named characteristic is at least `value`. */
  readonly autoQualifyAtLeast?: { readonly attribute: string; readonly value: number };
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
  // Apply a SPECIFIC Injury table row by its roll value (Core p.49). The mishap
  // roll-1 "Severely injured (same as a result of 2 on the Injury table)" uses
  // { roll: 2 } as one branch of its player choice.
  | { readonly kind: "applyInjury"; readonly roll: number }
  | { readonly kind: "lifeEvent" }
  | { readonly kind: "autoPromote" }
  | { readonly kind: "forceCareer"; readonly career: string }
  | { readonly kind: "leaveCareer"; readonly keepBenefit: boolean }
  // "gain any one skill": from trained skills only (existingOnly), else the
  // full skill catalog. `exclude` drops named skills (Prisoner event 6: "except
  // Jack-of-all-Trades", Core p.57).
  | { readonly kind: "gainAnySkill"; readonly level?: number; readonly existingOnly?: boolean;
      readonly exclude?: readonly string[] }
  | { readonly kind: "modifyCharacteristicChoice"; readonly characteristics: readonly string[]; readonly delta: number }
  | { readonly kind: "autoCommission" }
  | { readonly kind: "benefitRoll"; readonly delta: number }
  | { readonly kind: "stayInCareer" }
  | { readonly kind: "qualificationDm"; readonly dm: number; readonly scope: "next" | "any" }
  | { readonly kind: "survivalDm"; readonly dm: number; readonly scope: "next" | "any" }
  | { readonly kind: "rollDraft" }
  | { readonly kind: "forfeitBenefits" }
  | { readonly kind: "offerCareer"; readonly career: string }
  | { readonly kind: "rollForceCareer"; readonly dice: string; readonly results: readonly number[]; readonly career: string }
  // Player-choice between heterogeneous effect bundles ("gain X or DM+4"; a "may
  // ..." option includes an empty [] branch = decline). One branch is applied.
  | { readonly kind: "chooseEffect"; readonly options: readonly (readonly MongooseEffect[])[] }
  // An embedded skill/characteristic check whose outcome branches into further
  // effects (e.g. Agent event 3: "Roll Investigate 8+ ... on success ...").
  // `onNatural2` additionally fires when the natural 2D roll is exactly 2,
  // independent of pass/fail (Agent mishap 3: "If you roll 2 ...", Core p.23).
  | { readonly kind: "check"; readonly options: readonly string[]; readonly target: number;
      readonly onSuccess: readonly MongooseEffect[]; readonly onFailure: readonly MongooseEffect[];
      readonly onNatural2?: readonly MongooseEffect[] }
  // --- Prisoner career (Core p.52) ---
  // Adjust the parole threshold by a fixed integer or a die-string delta
  // ("-1D", "+2D"): parsed sign + NdX, clamped to the career's parole.max.
  | { readonly kind: "modifyParoleThreshold"; readonly delta: number | string }
  // Re-roll the parole threshold from the career's parole config (Transferred).
  | { readonly kind: "rerollParoleThreshold" }
  // Roll 1D and apply the effects of the matching sub-table entry (entries are
  // 1-indexed by the roll; index 0 unused). Used by the Prisoner prison event.
  | { readonly kind: "rollSubTable"; readonly entries: readonly (readonly MongooseEffect[])[] };

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
  readonly qualification: MongooseCheck;
  /** Commission check target — Army / Navy / Marine only. */
  readonly commission?: MongooseCheck;
  readonly assignments: readonly MongooseAssignment[];
  /** Citizen / Drifter only (Core p.18): basic training draws from the chosen
   *  Assignment skill table instead of Service Skills. */
  readonly basicTrainingFromAssignment?: boolean;
  readonly skillTables: MongooseSkillTables;
  readonly ranks: MongooseRanks;
  readonly events: readonly MongooseTableRow[];
  readonly mishaps: readonly MongooseTableRow[];
  readonly musterOut: readonly MongooseMusterRow[];
  /** Prisoner only (Core p.52): entered solely via a forced-career reference,
   *  never offered as a normal / drafted / offered career choice. */
  readonly forcedOnly?: boolean;
  /** Prisoner only (Core p.52): a Parole Threshold governs release instead of
   *  the normal roll<=terms leave rule. `dice`+`plus` is the initial 1D+2 roll;
   *  the threshold never rises above `max` (12). */
  readonly parole?: { readonly dice: string; readonly plus: number; readonly max: number };
}

/** A characteristic reduction (ageing / injury): reduce `count` characteristics
 *  drawn from `pool` by `amount` — a fixed number or a die string like "1D".
 *  Every JSON row names its pool explicitly (usually the three physical). */
export interface MongooseReduction {
  readonly count: number;
  readonly amount: number | string;
  readonly pool: readonly string[];
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
  /** Background skills granted from adolescence (Core p.10): the count is this
   *  base plus the character's EDU DM, so background skill count = base + EDU
   *  DM (base 3 gives the printed 0-6 range). */
  readonly backgroundSkillBase: number;
  /** Background skill table (Core p.10). */
  readonly backgroundSkills: readonly string[];
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
  /** Max free skills from the Connections rule (Core p.19: 2). */
  readonly connectionSkillCap: number;
  /** A connection skill may not be raised above this level (Core p.19: 3). */
  readonly connectionSkillMaxLevel: number;
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
  /** Cash-column Benefit-roll skill bonus (Core p.46: Gambler grants DM+1). */
  readonly cashBonusSkill: { readonly skill: string; readonly dm: number };
  /** Skills the Connections rule may never grant (Core p.19: Jack-of-all-Trades). */
  readonly connectionSkillExcluded: readonly string[];
  /** Qualification DM applied per previous career (Core p.18: -1). */
  readonly qualificationDmPerPriorCareer: number;
  /** Commission DM applied per term after the first (Core p.19: -1). */
  readonly commissionDmPerTermAfterFirst: number;
  /** Ageing DM applied per total term (Core p.49: -1; roll is 2D - total terms). */
  readonly agingDmPerTerm: number;
  /** Life Event roll that triggers the Unusual Event sub-table (Core p.46: 12). */
  readonly lifeEventsUnusualTrigger: number;
  /** Career a drafted-out Traveller falls back into (Core p.20: Drifter). */
  readonly draftFallbackCareer: string;
  /** Natural Survival roll that always fails (Core p.18: 2). */
  readonly survivalNaturalFail: number;
  /** Natural Advancement roll that forces continuing the career (Core p.18: 12). */
  readonly advancementNaturalContinue: number;
}
