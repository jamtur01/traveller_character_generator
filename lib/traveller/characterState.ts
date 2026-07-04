// Cohesive state sub-objects clustered off the Character god-object
// (ArchitectureReview HIGH-1). Each owns a related field group and the
// reset that enforces its lifecycle scope in ONE place, replacing the
// per-field manual resets that used to be scattered across the engine
// runners. Defined here (a sibling of character.ts) rather than in
// editions/types.ts so the engine's data shape stays out of the edition
// surface.

/** Muster-out bookkeeping plus the skill-table force flags (the row-audit
 *  test path). Clustered so the muster roll budget, cash-roll accounting,
 *  the paused-roll sentinel, and force-table selection live behind one
 *  owned object with a single reset. */
export class MusterState {
  /** Force a specific skill table in serviceLoader.acquireSkill (the
   *  row-audit / session skill-pick path), bypassing the interactive
   *  picker so index-level tests stay deterministic. */
  forceTable!: boolean;
  /** Which table index the forceTable path resolves. Also drives the
   *  UI's basic-vs-advanced skill-picker phase (≥3 → advanced). */
  forceTableIndex!: number;
  /** Cash muster-out rolls spent (capped by rules.maxCashTableRolls). */
  musterCashUsed!: number;
  /** Muster-out rolls remaining. */
  musterRolls!: number;
  /** Transient UI flag: the current muster roll (cash or benefit) paused
   *  on a cascade or nested choice and hasn't completed yet. Set when the
   *  muster-out handler catches a ChoicePendingError; cleared by
   *  resolvePending after the choice chain drains. While true, musterRolls
   *  must NOT be decremented — the roll's player-visible work isn't done. */
  pendingMusterRoll!: boolean;
  /** Human-readable log of each muster-out roll's outcome (plus any
   *  in-service bonuses, e.g. the Merchant Prince half-cash bonus). */
  musterLog!: string[];

  constructor() {
    this.reset();
  }

  /** Restore all muster bookkeeping to its fresh-character defaults. */
  reset(): void {
    this.forceTable = false;
    this.forceTableIndex = 1;
    this.musterCashUsed = 0;
    this.musterRolls = 0;
    this.pendingMusterRoll = false;
    this.musterLog = [];
  }

  /** Deep copy (independent musterLog array), preserving the reset/clone
   *  methods — cloneCharacter needs a value-object copy, not a bare spread. */
  clone(): MusterState {
    const next = new MusterState();
    next.forceTable = this.forceTable;
    next.forceTableIndex = this.forceTableIndex;
    next.musterCashUsed = this.musterCashUsed;
    next.musterRolls = this.musterRolls;
    next.pendingMusterRoll = this.pendingMusterRoll;
    next.musterLog = [...this.musterLog];
    return next;
  }
}

/** The anagathics sub-machine (MT PM p. 15): per-term intent/effect flags,
 *  the persistent standing order, the lifetime counters that feed muster
 *  and retirement accounting, and the apparent-age backing store. The
 *  per-term flags are cleared as a unit by resetPerTerm() at each term
 *  boundary — the invariant that used to be hand-maintained in the runners. */
export class AnagathicsState {
  /** Currently maintaining an anagathics supply — freezes apparent age
   *  while true; aging tracks chronological age when false. */
  onAnagathics = false;
  /** Per-term: anagathics taken this term. -1 survival DM, no muster
   *  benefit roll this term. Declared before survival. */
  anagathicsActiveThisTerm = false;
  /** Per-term: character lost the anagathics supply this term — double
   *  saving throws on aging. */
  anagathicsWithdrawalThisTerm = false;
  /** True once the character has ever opted into anagathics: caps cash
   *  table rolls permanently. */
  anagathicsEverTaken = false;
  /** Count of terms whose muster-out benefit roll was forfeited to
   *  anagathics (PM p. 15). Also drives retirement pay. */
  anagathicsBenefitForfeitedTerms = 0;
  /** Count of terms that both secured anagathics AND became short terms.
   *  Such a term is subtracted by both shortTermsCount and
   *  anagathicsBenefitForfeitedTerms; musterOutRolls adds this back so the
   *  term is excluded exactly once. Does not affect retirement pay. */
  anagathicsShortTermOverlap = 0;
  /** Per-term: player has declared intent to use anagathics this term.
   *  Set before survival; cleared each term. When true, survival receives
   *  the -1 (-2 for nobles) DM whether or not the supply is later found. */
  wantsAnagathicsThisTerm = false;
  /** Persistent player preference: re-assert anagathics intent each term
   *  once eligible. The pre-survival hook copies this into
   *  wantsAnagathicsThisTerm at the start of each term. */
  anagathicsStandingOrder = false;

  /** Stored apparent-age line (the Aging-table row the character is on).
   *  0 is the "not yet snapshotted" sentinel — resolveApparentAge reports
   *  chronological age until doAging or anagathics assigns a real value.
   *  Written directly by the aging / anagathics steps via Character's
   *  apparentAge setter. */
  apparentAgeLine = 0;

  /** Resolve the apparent age against a chronological age: the stored line,
   *  or chronoAge while still at the 0 sentinel (so UI / PDF reads before
   *  the first aging term don't see 0). */
  resolveApparentAge(chronoAge: number): number {
    return this.apparentAgeLine === 0 ? chronoAge : this.apparentAgeLine;
  }

  /** Pin apparent age to the given chronological age if it's still the
   *  0 sentinel. Idempotent — lets a later anagathics opt-in freeze the
   *  field from the value at aging time rather than from raw age. */
  snapshotApparentAge(chronoAge: number): void {
    if (this.apparentAgeLine === 0) this.apparentAgeLine = chronoAge;
  }

  /** Clear the per-term flags at the start of each term (PM p. 15:
   *  anagathics intent is declared before the term's first survival roll).
   *  Consolidates the manual resets that lived in term.ts and the ACG
   *  runner so per-term scope is enforced in one place. */
  resetPerTerm(): void {
    this.anagathicsActiveThisTerm = false;
    this.anagathicsWithdrawalThisTerm = false;
    this.wantsAnagathicsThisTerm = false;
  }

  /** Deep copy, preserving methods and the apparent-age line —
   *  cloneCharacter needs a value-object copy, not structuredClone (which
   *  would drop the prototype and its methods). */
  clone(): AnagathicsState {
    const next = new AnagathicsState();
    next.onAnagathics = this.onAnagathics;
    next.anagathicsActiveThisTerm = this.anagathicsActiveThisTerm;
    next.anagathicsWithdrawalThisTerm = this.anagathicsWithdrawalThisTerm;
    next.anagathicsEverTaken = this.anagathicsEverTaken;
    next.anagathicsBenefitForfeitedTerms = this.anagathicsBenefitForfeitedTerms;
    next.anagathicsShortTermOverlap = this.anagathicsShortTermOverlap;
    next.wantsAnagathicsThisTerm = this.wantsAnagathicsThisTerm;
    next.anagathicsStandingOrder = this.anagathicsStandingOrder;
    next.apparentAgeLine = this.apparentAgeLine;
    return next;
  }
}
