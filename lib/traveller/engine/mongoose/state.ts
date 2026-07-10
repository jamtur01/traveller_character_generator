// Runtime state for a Mongoose Traveller 2e character. The mongoose ChargenModel
// (engine/mongoose/*) reads and mutates this; it is lazily created when the
// mongoose flow begins and carried on `Character.mongooseState`. All fields are
// plain/serializable so cloneCharacter can structuredClone it for the
// event-sourced re-execution model.

/** A dice modifier accrued from an event, applied to a later roll. `scope`
 *  "next" is consumed by the next matching roll; "any" persists until used. */
export interface MongoosePendingDm {
  dm: number;
  scope: "next" | "any";
}

/** Pending DM accumulators, one bucket per roll type they target. */
export interface MongoosePendingDms {
  qualification: MongoosePendingDm[];
  survival: MongoosePendingDm[];
  advancement: MongoosePendingDm[];
  benefit: MongoosePendingDm[];
}

/** A person the Traveller knows (Core pp.20-21). */
export interface MongooseConnection {
  relation: "contact" | "ally" | "rival" | "enemy";
  /** Narrative note / source event. */
  note: string;
}

/** A completed (or in-progress) career stint, for the sheet + history. */
export interface MongooseCareerRecord {
  career: string;
  assignment: string;
  terms: number;
  finalRank: number;
  commissioned: boolean;
}

/** Per-term scope — cleared at the start of each term via resetMongoosePerTerm. */
export interface MongoosePerTerm {
  /** Advancement rolled a natural 12: must remain in this career (Core p.18). */
  mustContinue: boolean;
  /** Advancement roll <= terms in this career: must leave after this term. */
  mustLeave: boolean;
  survived: boolean;
  commissionedThisTerm: boolean;
  advancedThisTerm: boolean;
  /** A mishap set stayInCareer — override the default ejection this term. */
  noEject: boolean;
  /** Lose this term's benefit roll (mishap / ejected leave). */
  loseBenefitThisTerm: boolean;
  /** A leaveCareer{keepBenefit:true} fired this term (a "keep your benefit"
   *  mishap/event branch): the mishap's forced benefit-loss must not clobber it. */
  benefitKept: boolean;
}

/** Full Mongoose chargen state. */
export interface MongooseState {
  /** Current career id, or null before the first enlistment / between careers. */
  career: string | null;
  /** Current assignment id within the career. */
  assignment: string | null;
  /** Rank number on the current ladder (0-6). */
  rank: number;
  /** True once commissioned (advances on the officer ladder). */
  commissioned: boolean;
  /** Terms spent in the CURRENT career (resets on career change). */
  termsInCareer: number;
  /** Completed careers so far — the qualification DM is -1 per previous career. */
  careerCount: number;
  /** The Draft may only be entered once per lifetime (Core p.20). */
  draftedOnce: boolean;
  /** Career history for the sheet. */
  history: MongooseCareerRecord[];
  /** Benefit rolls earned (spent at mustering out); +1 per term plus rank/event
   *  bonuses. */
  benefitRolls: number;
  /** Cash benefit rolls taken (capped at 3 across the whole career, Core p.46). */
  cashRollsUsed: number;
  /** Event-granted dice modifiers pending on future rolls. */
  pendingDms: MongoosePendingDms;
  connections: MongooseConnection[];
  perTerm: MongoosePerTerm;
  /** Career the character is forced into next term (event/mishap/life event);
   *  the model routes on it and clears it. */
  forcedNextCareer: string | null;
  /** Career offered without a qualification roll next term (optional switch). */
  offeredNextCareer: string | null;
  /** Must roll on the Draft next term (event). */
  mustDraft: boolean;
  /** Prisoner-career parole threshold (Core p.52): initialised to 1D+2 on
   *  entering a career with a `parole` config, cleared to null on leaving. When
   *  non-null, the advancement roll total (2D+DM) governs release: > threshold
   *  releases, otherwise the Traveller must serve another term. */
  paroleThreshold: number | null;
  /** A mishap forfeited ALL Benefit rolls from the current career (Core p.34
   *  merchant mishap 2, p.52 prisoner mishap 3, p.44 scholar mishap 5). Unlike
   *  benefitRolls (event bonuses only), this zeroes the term/rank rolls at
   *  muster. Career-scoped: reset on entering the next career. */
  benefitsForfeited: boolean;
  /** The career left at the end of the previous term. Core p.18 bars returning
   *  to it in the immediate next term via the normal picker; the Drifter career
   *  (always open) and the draft (may re-enter an ejected career) are exempt.
   *  Overwritten on each muster-out; consulted once at the next career choice. */
  lastLeftCareer: string | null;
}

/** A blank set of pending-DM buckets. Reset on entering a new career so a
 *  career-scoped ("any") DM never leaks into the next career (Core p.52). */
export function freshPendingDms(): MongoosePendingDms {
  return { qualification: [], survival: [], advancement: [], benefit: [] };
}

function freshPerTerm(): MongoosePerTerm {
  return {
    mustContinue: false,
    mustLeave: false,
    survived: false,
    commissionedThisTerm: false,
    advancedThisTerm: false,
    noEject: false,
    loseBenefitThisTerm: false,
    benefitKept: false,
  };
}

/** A blank Mongoose state for a character entering the mongoose flow. */
export function freshMongooseState(): MongooseState {
  return {
    career: null,
    assignment: null,
    rank: 0,
    commissioned: false,
    termsInCareer: 0,
    careerCount: 0,
    draftedOnce: false,
    history: [],
    benefitRolls: 0,
    cashRollsUsed: 0,
    pendingDms: freshPendingDms(),
    connections: [],
    perTerm: freshPerTerm(),
    forcedNextCareer: null,
    offeredNextCareer: null,
    mustDraft: false,
    paroleThreshold: null,
    benefitsForfeited: false,
    lastLeftCareer: null,
  };
}

/** Clear the per-term scope at the start of a new term. */
export function resetMongoosePerTerm(state: MongooseState): void {
  state.perTerm = freshPerTerm();
}

/** Drain the pending DMs for a roll type: returns the summed modifier and
 *  removes the "next"-scoped entries (consumed), keeping "any"-scoped ones. */
export function consumePendingDm(
  dms: MongoosePendingDm[],
): number {
  const total = dms.reduce((sum, d) => sum + d.dm, 0);
  // Mutate in place: keep only persistent ("any") modifiers.
  const persistent = dms.filter((d) => d.scope === "any");
  dms.length = 0;
  dms.push(...persistent);
  return total;
}
