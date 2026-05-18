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

/** Helper for pathway code to log a transfer event into acgState. */
export function recordTransfer(
  state: AcgState,
  kind: "branch" | "department" | "lineType" | "combatArm" | "division" | "office",
  from: string,
  to: string,
  yearOfService: number,
): void {
  if (from === to) return;
  if (!state.transferHistory) state.transferHistory = [];
  state.transferHistory.push({ yearOfService, from, to, kind });
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
  /** Last interactive BP review spend (rollName + spent). The pathway code
   *  may read this to retroactively upgrade an outcome. */
  lastBpExtraSpend?: { rollName: string; spent: number };

  /** Combat arms or branches the character has been cross-trained into via
   *  special-assignment schools. Drives the Marine cross-training reenlist
   *  DM (PM p. 51) and similar branch-eligibility rules. */
  crossTrainedArms?: string[];
  /** Navy branches the character has been cross-trained into. Cross-training
   *  records eligibility for reenlistment branch-change (PM p. 53) — it does
   *  NOT immediately transfer the character. */
  crossTrainedBranches?: string[];

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
  /** Years spent on Navy Frozen Watch (PM p. 53). Character is physically
   *  one year younger per year of Frozen Watch. */
  frozenWatchYears?: number;
  /** Physical-age offset relative to chronological character.age. Negative
   *  when the character has spent time in suspended animation (Frozen
   *  Watch) — physicalAge = age + physicalAgeOffset. */
  physicalAgeOffset?: number;
  /** Merchant Prince O0 holders must pass exam for O1 within 4 years or
   *  revert to enlisted (PM Special Duty Commission entry). Stores the
   *  yearsServed value at which the deadline passes; cleared on promotion. */
  commissionO0DeadlineYear?: number;

  // Resume/sheet fields (PM "Resumes" p. 47).
  /** Per-event log of branch / department / line / arm transfers, each
   *  stamped with the year-of-service at which it occurred. */
  transferHistory?: Array<{
    yearOfService: number;
    from: string;
    to: string;
    kind: "branch" | "department" | "lineType" | "combatArm" | "division" | "office";
  }>;
  /** Subsector tech code recorded at character generation start (PM
   *  requires this for Naval characters and is harmless for others). */
  subsectorTechCode?: string;
  /** Dischargeworld — the homeworld-style world where the character left
   *  the service. Distinct from homeworld for travellers who served
   *  elsewhere. Free-text (UPP code or world name). */
  dischargeworld?: string;
  /** ISO date string for birthdate (Imperial calendar). Stored as a
   *  free-text field — campaigns vary on canonical form. */
  birthdate?: string;
  /** Equipment qualified on: weapons/vehicles the character has at least
   *  one skill level in, suitable for resume output. Derived but cached. */
  equipmentQualifiedOn?: string[];

  // Interactive-mode runner resumption state.
  /** When a substep of runAcgYear queued an interactive choice and threw
   *  ChoicePendingError, the runner records the substep name here so the
   *  next runAcgYear call resumes from the right place. Null when the
   *  year isn't paused. */
  pausedAtStep?: string | null;
  /** Set true after the one-shot initial training fires (first year of
   *  first term). Prevents replay on resumption. */
  initialTrainingDone?: boolean;
  /** Reason a reenlistment was denied by pathway logic (e.g. scout
   *  up-or-out). Threaded into the next ev.reenlistment("denied") event;
   *  consumed by character.ts after emission. */
  reenlistDenialReason?: string;

  // Scout pathway: resumption fields for interactive choices.
  // Closure-local variables used to hold decisions across a pickOrDefer
  // throw + resolve cycle, but closures die with the throw. These store
  // the resolved decision on acgState so a re-entry of scoutResolveAssignment
  // reads it rather than re-prompting.
  /** Scout: whether to accept the Field→Bureaucracy transfer offer. */
  scoutTransferDecision?: boolean;
  /** Scout: whether to take the administrator DM on the duty roll. */
  scoutAdminDmDecision?: boolean;
  /** Scout: marks that applyScoutTransferToBureaucracy already ran this
   *  year. Re-entry from pause/resume skips the transfer side effects. */
  transferAppliedThisYear?: boolean;
  /** Scout: cached post-transfer assignment so the recursive resolve
   *  doesn't re-roll non-deterministically on pause/resume. Cleared at
   *  year boundary alongside transferAppliedThisYear. */
  scoutTransferNextAssign?: string;

  // Merchant Prince: per-term flags consumed at end-of-term.
  /** Merchant Prince: true if any year of the current term was a Route
   *  assignment (PM p. 61: enlisted commission exam available if "they
   *  are serving on a Route assignment"). Reset at startOfTerm. */
  routeAssignmentThisTerm?: boolean;

  /** Per-year capture of acg.justRetained snapshotted before the
   *  pathway's rollAssignment clears it. Used to annotate the
   *  assignmentRolled event with retention status, surviving a
   *  pause/resume cycle (the resumed run reads this instead of the
   *  already-cleared justRetained flag). Cleared at year boundary. */
  wasRetainedThisYear?: boolean;

  /** Sub-step idempotence cache for resolveAssignment. Each phase stores
   *  the dice outcome + any auto-mitigation spend so a pause/resume on
   *  an interactive choice (BP review etc.) doesn't re-roll the phase
   *  or double-spend brownie points. Phase-applied flags gate
   *  non-idempotent side effects (decoration push, addSkill, etc.).
   *  Cleared at year boundary by the runner. */
  thisYearOutcomes?: ThisYearOutcomes;
}

/** Per-sub-step result captured for resume idempotence. */
export interface SubStepOutcome {
  /** Dice roll value (after dm). */
  roll?: number;
  /** Applied DM total. */
  dm?: number;
  /** Target throw. */
  target?: number;
  /** Pass / fail. */
  success?: boolean;
  /** Margin (positive = pass by N, negative = fail by N). */
  margin?: number;
  /** BPs auto-mitigated this sub-step (so re-runs return the cached
   *  spend rather than spending again). */
  autoMitigated?: number;
  /** Margin after auto-mitigation. */
  marginAfterMit?: number;
}

/** Per-year sub-step cache. Each key may hold a SubStepOutcome plus
 *  side-effect "applied" flags to gate non-idempotent state changes. */
export interface ThisYearOutcomes {
  survival?: SubStepOutcome;
  promotion?: SubStepOutcome;
  decoration?: SubStepOutcome;
  skills?: SubStepOutcome;
  bonus?: SubStepOutcome;
  /** Side-effect-applied flags keyed by a phase-local string. Pathway
   *  code uses these to guard non-idempotent side effects (decoration
   *  push, rank++, log calls) on re-entry. */
  applied?: Record<string, boolean>;
  /** True once a pathway's resolveAssignment ran to completion this
   *  year. Lets pathways detect a stale prior-year cache when they're
   *  invoked directly (outside runAcgYear which clears at year end)
   *  and reset before starting fresh. */
  complete?: boolean;
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
