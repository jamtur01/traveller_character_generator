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
}

function freshPendingDms(): MongoosePendingDms {
  return { qualification: [], survival: [], advancement: [], benefit: [] };
}

function freshPerTerm(): MongoosePerTerm {
  return {
    mustContinue: false,
    mustLeave: false,
    survived: false,
    commissionedThisTerm: false,
    advancedThisTerm: false,
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
