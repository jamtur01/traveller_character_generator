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
