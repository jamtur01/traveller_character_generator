// ACG character state — Character.acgState. Distinct from chargen/types
// because ACG has its own state model: 4 one-year assignments per term,
// command-duty rolls for officers, retention rolls, MOS/branch/office/
// department selection, combat ribbons, etc. Resolution-table types
// (AssignmentResolution, ResolutionTarget) live in ./types alongside
// the engine-side resolution code.

export type AcgPathwayId = "mercenary" | "navy" | "scout" | "merchantPrince";

/** All per-character ACG state is a `pathway`-discriminated union
 *  (MercenaryAcgState | NavyAcgState | ScoutAcgState | MerchantAcgState).
 *  BaseAcgState holds the pathway-agnostic fields; each variant adds its
 *  role-selection fields as non-optional so pathway code reads them without
 *  optional-chaining once narrowed on `pathway` (require*Acg / assertPathway). */
export interface BaseAcgState {
  pathway: AcgPathwayId;

  // Rank ladder state. Code is service-specific (E1-E9, O1-O10, IS-1
  // through IS-18). isOfficer drives command-duty eligibility and the
  // per-term promotion cap.
  rankCode: string;
  isOfficer: boolean;

  // Per-term cycle state.
  year: number;            // 1..4 within current term
  currentAssignment: string | null;
  inCommand: boolean;      // result of this year's command duty roll
  justRetained: boolean;
  retainedAssignment: string | null;
  injuredThisYear: boolean;

  /** Term-scoped markers, reset wholesale each term by the runner
   *  (`acg.perTerm = freshPerTerm()`). */
  perTerm: PerTermAcgState;

  // Resume / record fields.
  assignmentHistory: string[];
  combatRibbons: number;
  commandClusters: number;
  schoolsAttended: string[];
  decorations: string[];
  browniePoints: number;
  browniePointsSpent: number;

  /**
   * Player strategy on the survival↔decoration DM trade-off. Per MT
   * rules a character may take a negative DM on survival in exchange for
   * an equal positive DM on the decoration roll. Negative value here =
   * trade that magnitude. 0 = no trade. Positive values (positive on
   * survival, negative on decoration) are also legal but uncommon.
   */
  decorationDmStrategy: number;

  /** Set when pre-career (Military/Naval/Merchant Academy graduation or
   *  successful OTC/NOTC) commissioned the character before ACG enlist.
   *  beginAcg() preserves rank O1 instead of resetting to E1 when this is
   *  true. (Manual: academy graduates auto-enlist at rank O1.) */
  preCareerCommission?: boolean;
  preCareerBranch?: "army" | "marines" | "navy" | "merchants" | null;
  /** Pre-career options the character graduated with honors. Honors gates
   *  Commando entry (Mil Academy honors), Medical/Flight School admission,
   *  Scout IS-10 (college honors), and Merchant Academy department choice. */
  honorsGraduations?: string[];
  /** Pre-career options the character has already attempted regardless of
   *  outcome (admission denied, washed out, or graduated). Used by the UI
   *  to remove a school from the picker after it's been tried — RAW
   *  doesn't allow re-applying to the same school. */
  schoolsAttempted?: string[];
  /** PM p. 47: pre-career failure forces a short (3-year) first term. */
  preCareerFirstTermShort?: boolean;
  /** PM p. 47: pre-career failure may draft the character into a specific
   *  service (Navy/Army) regardless of homeworld restrictions. */
  preCareerDraftedInto?: "army" | "navy" | "marines";
  /** Player's opt-in for Merchant Academy (PM p. 47: "may apply").
   *  Set by the UI before merchant enlistment runs. Default: skip. */
  attemptMerchantAcademy?: boolean;
  /** Brownie-point auto-spend policy (PM p. 46 "any number").
   *  - "manual": auto layer never spends; player decides every spend.
   *  - "conservative" (default for auto mode): caps lesser rolls.
   *  - "aggressive": spends up to need on any failed roll. */
  bpAutoPolicy?: "conservative" | "aggressive" | "manual";

  /** Combat arms or branches the character has been cross-trained into via
   *  special-assignment schools. Drives the Marine cross-training reenlist
   *  DM (PM p. 51) and similar branch-eligibility rules. */
  crossTrainedArms?: string[];
  /** Navy branches the character has been cross-trained into. Cross-training
   *  records eligibility for reenlistment branch-change (PM p. 53) — it does
   *  NOT immediately transfer the character. */
  crossTrainedBranches?: string[];

  // Merchant Prince specific: promotion-exam state.
  /** Free Trader Owner/Captain (rank O5+) at muster-out gets an automatic
   *  Free Trader ship. Set when the rank reaches that threshold. */
  freeTraderShipEarned?: boolean;
  /** Temporary rank-down for skill-column selection when the available-
   *  position throw failed (Merchant officer, no position available).
   *  Cleared at the start of each year. */
  effectiveRankCode?: string | null;

  // Court-martial / discipline consequences propagated to final muster.
  /** -N to the next promotion roll (court-martial Reprimand outcome). */
  nextPromotionPenalty?: number;
  /** Pre-muster adjustment to mustering-out roll count (e.g. -3 for DD). */
  musterRollPenalty?: number;
  /** True if pension is forfeit (DD or worse). */
  pensionForfeit?: boolean;
  /** SEH recipients get an automatic +1 rank at muster (manual p. 46).
   *  Set true the first time an SEH is awarded; consumed at muster. */
  sehPromotionPending?: boolean;

  /** Accumulated physical-age offset relative to chronological age
   *  (`ch.age`); always <= 0. Navy Frozen Watch assignments (PM p. 56)
   *  spend a year in cold sleep: chronological age advances, physical age
   *  does not ("one year older chronologically than physically for each
   *  year on Frozen Watch"). doAging drives the aging-table saving throws
   *  off physical age (chronological + this offset), reusing the same
   *  age-basis path as the anagathics apparent-age mechanism. */
  physicalAgeOffset?: number;

  /** Total years served across all terms — incremented per year inside
   *  runAcgYear. Distinct from terms (which counts terms entered) because
   *  a character invalided/jailed mid-term gets a partial term that doesn't
   *  contribute the full 4 years. */
  yearsServed?: number;
  /** Cumulative age (years) gained from pre-career schooling — pre-career
   *  academies/colleges/schools age the character (PM p. 47). Retained as an
   *  explicit summand so chronological age is exactly reconstructable. */
  preCareerAgeYears?: number;
  /** Cumulative age (years) added by jail sentences (PM p. 47). Retained as an
   *  explicit summand so chronological age is exactly reconstructable. */
  imprisonmentAgeYears?: number;
  /** Count of terms that were started but not completed (4 years). Used
   *  by musterOutRolls to discount benefits from short terms. */
  partialTerms?: number;
  /** Bounty in KCr on the character's head after a death-sentence escape
   *  (PM p. 47: KCr10 base, KCr100 if escape killed guards). */
  bountyOnHeadKCr?: number;
  /** Guards killed during a death-sentence escape (PM p. 47: "killing 1D
   *  guards"). Recorded for resume/sheet output. */
  guardsKilledInEscape?: number;
  /** Merchant Prince O0 holders must pass exam for O1 within 4 years or
   *  revert to enlisted (PM Special Duty Commission entry). Stores the
   *  yearsServed value at which the deadline passes; cleared on promotion. */
  commissionO0DeadlineYear?: number;

  // Resume/sheet fields (PM "Resumes" p. 47).
  /** Subsector tech code recorded at character generation start (PM
   *  requires this for Naval characters and is harmless for others). */
  subsectorTechCode?: string;

  /** Reason a reenlistment was denied by pathway logic (e.g. scout
   *  up-or-out). Threaded into the next ev.reenlistment("denied") event;
   *  consumed by character.ts after emission. */
  reenlistDenialReason?: string;
}

/** Mercenary pathway: Army/Marines combat-arms service. */
export interface MercenaryAcgState extends BaseAcgState {
  pathway: "mercenary";
  /** Combat arm (Infantry, Cavalry, Artillery, ...); null until enlistment
   *  assigns it. */
  combatArm: string | null;
  /** Service branch: "Army" | "Marines" (drafted values also land here). */
  branch: string;
  /** Military Occupational Specialty skill; null until initial training. */
  mos: string | null;
}

/** Navy pathway: Imperial/Reserve/System fleet service. */
export interface NavyAcgState extends BaseAcgState {
  pathway: "navy";
  fleet: "imperialNavy" | "reserveFleet" | "systemSquadron";
  /** Naval branch ("Line" | "Crew" | "Medical" | "Flight" | ...); set at enlistment. */
  branch: string;
}

/** Scout pathway: Field vs Bureaucracy division service. */
export interface ScoutAcgState extends BaseAcgState {
  pathway: "scout";
  office: string | null;
  division: "field" | "bureaucracy";
}

/** Merchant Prince pathway: line/department service. */
export interface MerchantAcgState extends BaseAcgState {
  pathway: "merchantPrince";
  department: string | null;
  lineType: string | null;        // megacorp / sector-wide / Free Trader / etc
}

/** All per-character ACG state, discriminated on `pathway`. Lives on
 *  Character.acgState. Narrow via Character.require*Acg / assertPathway to
 *  read a variant's non-optional role fields. */
export type AcgState =
  | MercenaryAcgState
  | NavyAcgState
  | ScoutAcgState
  | MerchantAcgState;

/** Assert (and narrow) that an AcgState is on a given pathway. Replaces the
 *  former isXxxAcg type-guard functions; the require*Acg helpers call this. */
export function assertPathway<P extends AcgPathwayId>(
  acg: AcgState, pathway: P,
): asserts acg is Extract<AcgState, { pathway: P }> {
  if (acg.pathway !== pathway) {
    throw new Error(`Expected ${pathway} acgState, got pathway=${acg.pathway}`);
  }
}

/** Term-scoped ACG markers. The runner replaces this wholesale at each
 *  term boundary (`acg.perTerm = freshPerTerm()`). examDm and
 *  canTakeDeptTest are additionally consumed/reset at end-of-term by the
 *  merchant promotion exam. */
export interface PerTermAcgState {
  /** Set true when a promotion fired this term; gates the per-term
   *  promotion cap (officers promote at most once per term). */
  promotedThisTerm: boolean;
  /** Merchant Prince: true if any year of the current term was a Route
   *  assignment (PM p. 61: enlisted commission exam available if "they
   *  are serving on a Route assignment"). Reset at startOfTerm. */
  routeAssignmentThisTerm?: boolean;
  /** Per-term DM modifier accumulated from Special Duty schools (e.g.
   *  Business School: +1 on exam for O6+). */
  examDm?: number;
  /** True when the character has earned the right to take the department
   *  promotion exam without regard for skill requirements (Special Duty
   *  "Department Test" result). Consumed on next exam attempt. */
  canTakeDeptTest?: boolean;
}

/** Fresh term-scoped markers. The runner assigns this at each term
 *  boundary so term-gated flags (promotion cap, route/exam) start clean. */
export function freshPerTerm(): PerTermAcgState {
  return { promotedThisTerm: false };
}

/** Build a fresh AcgState for a pathway. Used by chargen entry points
 *  (beginAcg, doPreCareer) and tests that need a known-good baseline. */
export function freshAcgState(pathway: AcgPathwayId): AcgState {
  const base = {
    // Pre-enlistment placeholders: every pathway's enlist overwrites
    // rankCode/isOfficer from its JSON enlistment startingRank before any
    // rank-keyed read; "E1" is never consumed as a game value before then.
    rankCode: "E1",
    isOfficer: false,
    year: 1,
    currentAssignment: null,
    inCommand: false,
    justRetained: false,
    retainedAssignment: null,
    perTerm: freshPerTerm(),
    injuredThisYear: false,
    assignmentHistory: [],
    combatRibbons: 0,
    commandClusters: 0,
    schoolsAttended: [],
    decorations: [],
    browniePoints: 0,
    browniePointsSpent: 0,
    decorationDmStrategy: 0,
    // Age-provenance counters: start at 0, accumulated as pre-career
    // schooling / jail sentences age the character (see BaseAcgState).
    preCareerAgeYears: 0,
    imprisonmentAgeYears: 0,
  };
  switch (pathway) {
    case "mercenary":
      return { ...base, pathway, combatArm: null, branch: "", mos: null };
    case "navy":
      return { ...base, pathway, fleet: "imperialNavy", branch: "" };
    case "scout":
      return { ...base, pathway, office: null, division: "field" };
    case "merchantPrince":
      return { ...base, pathway, department: null, lineType: null };
  }
}

// ---------------------------------------------------------------------------
// Resolution types (one assignment row's targets + decoration outcome).
// Lived in a separate types.ts barrel that just re-exported state; merged
// here so consumers have a single canonical import path.
// ---------------------------------------------------------------------------

/** Resolution targets for one assignment row. Targets are either a
 *  numeric throw, "auto" (always succeeds), or "none" (no roll). */
export type ResolutionTarget = number | "auto" | "none";

export interface AssignmentResolution {
  survival: ResolutionTarget;
  decoration: ResolutionTarget;
  promotion: ResolutionTarget;
  skills: ResolutionTarget;
  /** "8+" style — when listed in parentheses on the table, officers may
   *  not roll for promotion under this assignment. */
  promotionOfficersBarred?: boolean;
}
