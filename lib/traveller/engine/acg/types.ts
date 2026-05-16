// ACG-specific types. Distinct from basic-chargen types because ACG has
// its own state model: 4 one-year assignments per term, command-duty
// rolls for officers, retention rolls, MOS/branch/office/department
// selection, combat ribbons, etc.

export type AcgPathwayId = "mercenary" | "navy" | "scout" | "merchantPrince";

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

/** A single row of an `assignment` table — keyed by die result. */
export interface AssignmentRow {
  die: number;
  [columnKey: string]: number | string;
}

export interface AssignmentTable {
  columns: string[];
  rows: AssignmentRow[];
  dms?: string[];
  notes?: string[];
}

export interface DecorationOutcome {
  /** Award earned, or null on no award. */
  award: "MCUF" | "MCG" | "SEH" | null;
  /** True when the decoration roll failed by 6+ (court martial). */
  courtMartial: boolean;
}

/** All the per-character ACG state. Lives on Character.acgState. */
export interface AcgState {
  pathway: AcgPathwayId;

  // Pathway-specific role selection (set on enlistment).
  combatArm?: string;      // Mercenary
  branch?: string;         // Navy / Merchant Prince department
  fleet?: string;          // Navy: "imperialNavy" | "reserveFleet" | "systemSquadron"
  office?: string;         // Scout
  division?: "field" | "bureaucracy"; // Scout
  department?: string;     // Merchant Prince
  lineType?: string;       // Merchant Prince: megacorp/sector/etc
  mos?: string;            // Mercenary

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
  promotedThisTerm: boolean;
  injuredThisYear: boolean;

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

  /** Combat arms or branches the character has been cross-trained into via
   *  special-assignment schools. Drives the Marine cross-training reenlist
   *  DM (PM p. 51) and similar branch-eligibility rules. */
  crossTrainedArms?: string[];

  // Merchant Prince specific: promotion-exam state.
  /** True when the character has earned the right to take the department
   *  promotion exam without regard for skill requirements (Special Duty
   *  "Department Test" result). Consumed on next exam attempt. */
  canTakeDeptTest?: boolean;
  /** Per-term DM modifier accumulated from Special Duty schools (e.g.
   *  Business School: +1 on exam for O6+). */
  examDm?: number;
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
  /** True if dishonorably discharged. Pension and mustering-out reductions
   *  are computed separately. */
  dishonorablyDischarged?: boolean;
  /** Pre-muster adjustment to mustering-out roll count (e.g. -3 for DD). */
  musterRollPenalty?: number;
  /** True if pension is forfeit (DD or worse). */
  pensionForfeit?: boolean;
  /** True if a court-martial death sentence was imposed (with or without
   *  escape). When true, no mustering-out benefits and no pension. */
  deathSentence?: boolean;
  /** Accumulated months of in-service jail; not currently consumed beyond
   *  the prose record, but observable for sheet/UI output. */
  jailMonthsThisYear?: number;
  /** SEH recipients get an automatic +1 rank at muster (manual p. 46).
   *  Set true the first time an SEH is awarded; consumed at muster. */
  sehPromotionPending?: boolean;

  /** Total years served across all terms — incremented per year inside
   *  runAcgYear. Distinct from terms (which counts terms entered) because
   *  a character invalided/jailed mid-term gets a partial term that doesn't
   *  contribute the full 4 years. */
  yearsServed?: number;
  /** Count of terms that were started but not completed (4 years). Used
   *  by musterOutRolls to discount benefits from short terms. */
  partialTerms?: number;
  /** Bounty in KCr on the character's head after a death-sentence escape
   *  (PM p. 47: KCr10 base, KCr100 if escape killed guards). */
  bountyOnHeadKCr?: number;
  /** Guards killed during a death-sentence escape (PM p. 47: "killing 1D
   *  guards"). Recorded for resume/sheet output. */
  guardsKilledInEscape?: number;
}

export function freshAcgState(pathway: AcgPathwayId): AcgState {
  return {
    pathway,
    rankCode: "E1",
    isOfficer: false,
    year: 1,
    currentAssignment: null,
    inCommand: false,
    justRetained: false,
    retainedAssignment: null,
    promotedThisTerm: false,
    injuredThisYear: false,
    assignmentHistory: [],
    combatRibbons: 0,
    commandClusters: 0,
    schoolsAttended: [],
    decorations: [],
    browniePoints: 0,
    browniePointsSpent: 0,
    decorationDmStrategy: 0,
  };
}
