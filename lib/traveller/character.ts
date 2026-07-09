// The Character class: rolls, terms, skills, muster-out. Service-specific
// tables live in `./services/*` and are looked up via the `s` registry inside
// method bodies (avoids module-load cycles).

import { Rng } from "./random";
import type { ChoiceMode, ChoiceRequest, PendingChoice } from "./engine/choices";
import { genChoiceId, ChoicePendingError } from "./engine/choices";
import type { HistoryEvent } from "./history";
import { event as ev, formatEvent } from "./history";
import type {
  AcgState, MercenaryAcgState, NavyAcgState,
  ScoutAcgState, MerchantAcgState,
} from "./engine/acg/state";
import {
  assertPathway, freshAcgState,
} from "./engine/acg/state";
import type { MongooseState } from "./engine/mongoose/state";
import {
  editionHasHomeworld,
  generateAndApplyHomeworld, type Homeworld,
} from "./engine/homeworld";
import {
  applyPreCareerResult, attemptPreCareer, type PreCareerOption,
} from "./engine/acg/preCareer";
import { generateGender, generateName } from "./names";
import { extendedHex } from "./formatting";
import {
  finalizeAcgRankForMuster as finalizeAcgRankForMusterImpl,
  musterOutBenefit as musterOutBenefitImpl,
  musterOutCash as musterOutCashImpl,
  musterOutPay as musterOutPayImpl,
  musterOutRolls as musterOutRollsImpl,
} from "./chargen/muster";
import {
  doEnlistment as doEnlistmentImpl,
  applyServiceStartAge as applyServiceStartAgeImpl,
  beginAcg as beginAcgImpl,
  type BeginAcgOptions,
} from "./chargen/enlistment";
import { doServiceTermStep as doServiceTermStepImpl } from "./chargen/term";
import { doReenlistmentStep as doReenlistmentStepImpl } from "./chargen/reenlist";
import {
  tryAnagathics as tryAnagathicsImpl,
  preSurvivalAnagathicsHook as preSurvivalAnagathicsHookImpl,
  discontinueAnagathics as discontinueAnagathicsImpl,
} from "./chargen/anagathics";
import {
  doAging as doAgingImpl,
  ageAttribute as ageAttributeImpl,
} from "./chargen/aging";
import {
  doBladeBenefit as doBladeBenefitImpl,
  doGunBenefit as doGunBenefitImpl,
  doWeaponBenefit as doWeaponBenefitImpl,
} from "./chargen/weaponBenefits";
import { enforceSkillCap as enforceSkillCapImpl } from "./chargen/skillCap";
import type {
  AttributeKey,
  Attributes,
  Gender,
  ServiceDef,
  ServiceKey,
  ShowHistory,
  Skill,
} from "./types";
import type { ChargenStatus } from "./types";
import { getEditionServices } from "./services";
import { DEFAULT_EDITION_ID, getEdition } from "./editions";
import { requireRule } from "./editions/strict";
import { formatCharacterSheet } from "./sheet";
import { AnagathicsState, MusterState } from "./characterState";

/** Roll the six initial 2d6 attributes. Consumes 12 Math.random calls
 *  — kept as a free helper so tests can inspect/replace it independent
 *  of the Character constructor. */
function rollInitialAttributes(rng: Rng): Attributes {
  return {
    strength: rng.roll(2),
    dexterity: rng.roll(2),
    endurance: rng.roll(2),
    intelligence: rng.roll(2),
    education: rng.roll(2),
    social: rng.roll(2),
  };
}

/** Options for the Character constructor. Tests that need deterministic
 *  attributes pass them in here instead of rolling 12 dice via the
 *  default field initializer and overriding afterward. */
export interface CharacterOptions {
  attributes?: Attributes;
  /** Seed the character's owned RNG stream for a reproducible run. Omit
   *  for a non-deterministic (Math.random-backed) stream. */
  seed?: number;
}

/** Structured result of a pre-career step (college / academy / school).
 *  `autoEnlistPathway` routes the caller to beginAcg; the flags report
 *  admission, graduation, and any direct commission earned. */
export interface PreCareerOutcome {
  autoEnlistPathway: "mercenary" | "navy" | "scout" | "merchantPrince" | null;
  admitted: boolean;
  honors: boolean;
  graduated: boolean;
  commissioned: boolean;
  notes: string[];
}

/** Recorded player decisions for one session action's re-execution. The
 *  session runs every action from a pristine pre-action base; pickOrDefer
 *  consumes `resolutions[pos]` for each interactive choice it re-encounters
 *  (in deterministic prompt order). The first choice past the end of
 *  `resolutions` is the frontier — it queues and pauses. */
export interface DecisionCursor {
  readonly resolutions: readonly number[];
  pos: number;
}

/** The pure data shape of a character — every stored (non-derived) field the
 *  engine mutates during chargen. `Character` implements this and layers the
 *  behavior (mutation kernel: log/addSkill/…; lifecycle facades that delegate
 *  to the free functions in chargen/*) on top. Derived getters (activeDuty,
 *  retired, apparentAge, isChargenEnded, …) are NOT part of the data — they
 *  compute from these fields. Splitting the data out makes the state explicit
 *  and serializable (cloneCharacter, and a seed+choice replay log). */
export interface CharacterState {
  rng: Rng;
  age: number;
  gender: Gender;
  name: string;
  showHistory: ShowHistory;
  terms: number;
  credits: number;
  events: HistoryEvent[];
  benefits: string[];
  ship: boolean;
  TAS: boolean;
  mortgage: number;
  bladeBenefit: string;
  gunBenefit: string;
  attributes: Attributes;
  skillPoints: number;
  skills: Skill[];
  drafted: boolean;
  service: ServiceKey;
  commissioned: boolean;
  rank: number;
  retirementPay: number;
  chargenStatus: ChargenStatus;
  shortTermsCount: number;
  muster: MusterState;
  anagathics: AnagathicsState;
  editionId: string;
  homeworld: Homeworld | null;
  choiceMode: ChoiceMode;
  chargenModelId: string;
  pendingChoices: PendingChoice<string>[];
  useAcg: boolean;
  acgPathway: string | null;
  acgState: AcgState | null;
  mongooseState: MongooseState | null;
}

export class Character implements CharacterState {
  /** Construct a fresh character. If `opts.attributes` is provided,
   *  skips the 12-dice initial roll — tests should prefer this over
   *  installing a Math.random mock pre-construction or overwriting
   *  attributes post-construction. Other field initializers
   *  (gender / name) still consume randomness — they're a 2-call
   *  footprint vs. attributes' 12. */
  constructor(opts: CharacterOptions = {}) {
    this.rng = opts.seed !== undefined ? new Rng(opts.seed) : new Rng();
    this.gender = generateGender(this.rng);
    this.name = generateName(this.gender, this.rng);
    this.attributes = opts.attributes ?? rollInitialAttributes(this.rng);
  }

  /** RNG stream owned by this run. Every draw the engine makes flows
   *  through here, so a seeded run (opts.seed) is fully reproducible —
   *  attributes, gender, and name are all assigned from it in the
   *  constructor — and the replay log can snapshot/restore the stream. */
  rng: Rng;
  age = 18;
  gender: Gender;
  name: string;
  showHistory: ShowHistory = "simple";
  terms = 0;
  credits = 0;
  /** Structured event log — the source-of-truth for all chargen history.
   *  The legacy `history` accessor below renders these on demand using
   *  the current `showHistory` level. Consumers that need a different
   *  visibility level should call `renderHistory(level)` directly. */
  events: HistoryEvent[] = [];

  /** Render the typed event log to formatted strings, filtered to the
   *  given level (defaults to this.showHistory). `none` accumulates the
   *  same events as `simple` (no extra filter); the display gate
   *  (toString / sheet / PDF rendering) is responsible for hiding them.
   *  Callers that want to suppress the rendered view should also check
   *  `c.showHistory !== "none"` before reading. */
  renderHistory(level: ShowHistory = this.showHistory): string[] {
    const out: string[] = [];
    for (const e of this.events) {
      if (e.level === "debug" && level !== "debug") continue;
      if (e.level === "verbose" && level === "simple") continue;
      out.push(formatEvent(e));
    }
    return out;
  }

  /** Legacy accessor — derives from `events` each read. Existing
   *  consumers (PDF, sheet, tests) still call `.history`; new code
   *  should prefer `renderHistory()` or read events directly. */
  get history(): string[] {
    return this.renderHistory();
  }
  benefits: string[] = [];
  ship = false;
  TAS = false;
  mortgage = 0;
  bladeBenefit = "";
  gunBenefit = "";
  // Initial attributes — rolled by the constructor (or supplied via
  // CharacterOptions to bypass the 12-dice randomness). Tests that need
  // deterministic attributes should pass them in via `new Character({
  // attributes: {...} })` rather than rolling-then-overwriting. Field
  // declaration only — assigned in the constructor so a caller-supplied
  // value skips the rollInitialAttributes call entirely.
  attributes: Attributes;
  skillPoints = 0;
  skills: Skill[] = [];
  drafted = false;
  service: ServiceKey = "other";
  commissioned = false;
  rank = 0;
  retirementPay = 0;
  /** Canonical chargen lifecycle state — 6-state discriminated union.
   *  Set via enterShortTerm / enterMandatoryReenlist / endChargenRetired
   *  / endChargenDeceased / endChargenDischarged / enterMustered /
   *  resumeActive helpers. */
  chargenStatus: ChargenStatus = { kind: "active" };

  /** Count of short terms served. Each one was 2 years (not 4) and
   *  does not count toward mustering-out benefit rolls. Persists past
   *  the shortTerm status transition (so muster-out accounting works
   *  after the character has moved on to retired/mustered). */
  shortTermsCount = 0;

  // --- Derived getters for back-compat with existing readers --- //
  /** True while the character is serving normally. Short-term flips
   *  this to false (PM p. 16: short-term character is leaving service)
   *  but the term continues — special-duty + skill rolls still fire
   *  because isChargenEnded is the runner's halt signal, not activeDuty. */
  get activeDuty(): boolean {
    return this.chargenStatus.kind === "active"
      || this.chargenStatus.kind === "mandatoryReenlist";
  }
  get deceased(): boolean {
    return this.chargenStatus.kind === "deceased";
  }
  /** True when the character retired *with* pension eligibility (the
   *  "retired" PDF checkbox). DD / forced-muster characters end with
   *  status="retired" but withPension=false. */
  get retired(): boolean {
    return this.chargenStatus.kind === "retired" && this.chargenStatus.withPension;
  }
  get musteredOut(): boolean {
    return this.chargenStatus.kind === "mustered";
  }
  get shortTermThisTerm(): boolean {
    return this.chargenStatus.kind === "shortTerm";
  }
  get mandatoryReenlistment(): boolean {
    return this.chargenStatus.kind === "mandatoryReenlist";
  }

  /** Per-term "short term forced by survival failure" entry point.
   *  PM p. 16: failure to make the survival throw forces a 2-year term;
   *  special-duty + skill rolls still fire. */
  enterShortTerm(reason: string): void {
    this.chargenStatus = { kind: "shortTerm", reason };
    this.shortTermsCount += 1;
    // A term that both secured anagathics (forfeiting its benefit roll)
    // and became a short term is excluded by BOTH counters. Record the
    // overlap in a dedicated counter so musterOutRolls can subtract each
    // excluded term exactly once (PM p. 15/16). Kept separate from
    // anagathicsBenefitForfeitedTerms, which also drives retirement pay.
    if (this.anagathics.anagathicsActiveThisTerm) {
      this.anagathics.anagathicsShortTermOverlap += 1;
    }
  }

  /** Rolled 12 on reenlistment → must serve another term. Consumed at
   *  the start of the next term via resumeActive(). */
  enterMandatoryReenlist(): void {
    this.chargenStatus = { kind: "mandatoryReenlist" };
  }

  /** Restore active status (called at the start of each term and by
   *  brownie-point revival paths that flip a forced-muster back to
   *  active). */
  resumeActive(): void {
    this.chargenStatus = { kind: "active" };
  }

  /** True when chargen has formally ended (deceased / left service /
   *  mustered-out). The engine runner reads this to halt term steps. */
  get isChargenEnded(): boolean {
    return this.chargenStatus.kind === "deceased"
      || this.chargenStatus.kind === "retired"
      || this.chargenStatus.kind === "mustered";
  }

  /** Terminate chargen as retired. Atomically updates status, logs the
   *  endGeneration event, and (by default) consults isRetirementEligible
   *  for pension eligibility. Court-martial paths that strip the pension
   *  pass `withPension: false`. */
  endChargenRetired(reason: string, withPension?: boolean): void {
    const pension = withPension ?? this.isRetirementEligible();
    this.chargenStatus = { kind: "retired", reason, withPension: pension };
    this.log(ev.endGeneration("retired", reason));
  }

  /** Court-martial discharge — chargen ends, but the character continues
   *  to muster-out (with the appropriate penalty flags on acgState). No
   *  pension. */
  endChargenDischarged(): void {
    this.chargenStatus = { kind: "retired", reason: "discharged", withPension: false };
    this.log(ev.endGeneration("retired", "discharged"));
  }

  /** Terminate chargen as deceased. */
  endChargenDeceased(reason: string): void {
    this.chargenStatus = { kind: "deceased", reason };
    this.log(ev.endGeneration("deceased", reason));
  }

  /** Transition to mustered-out state. Caller is responsible for the
   *  endGeneration("mustered") event since the UI controls when
   *  muster-out completes (after benefit rolls finish). */
  enterMustered(): void {
    this.chargenStatus = { kind: "mustered" };
  }

  /** Emit the canonical end-of-chargen marker for the muster-completion
   *  path. Idempotent: skipped if an endGeneration event was already
   *  logged (e.g. via endChargenRetired / endChargenDeceased /
   *  endChargenDischarged). This consolidates the four UI sites that
   *  finalize a muster-out so a single character can't accrue two
   *  endGeneration events in its history. */
  markMustered(): void {
    if (this.events.some((e) => e.kind === "endGeneration")) return;
    this.log(ev.endGeneration("mustered"));
  }
  /** Muster-out bookkeeping + skill-table force flags (MusterState). */
  muster = new MusterState();

  /** Anagathics sub-machine — per-term intent/effect flags, the persistent
   *  standing order, the lifetime muster/retirement counters, and the
   *  apparent-age line (AnagathicsState). */
  anagathics = new AnagathicsState();

  // Back-compat accessors: the UI (app/**), tests, and pdfSheet read these
  // through the flat Character surface, so the flat names remain a stable
  // public API. RULE: the sub-objects above are the single source of truth —
  // engine code always reads AND writes ch.muster.*/ch.anagathics.* directly;
  // these facades exist only to project to (or, for the standing order the
  // term UI toggles, forward to) them for the UI/test/PDF read surface.

  /** Muster-out rolls remaining (read by the muster UI / stepper). */
  get musterRolls(): number { return this.muster.musterRolls; }
  /** Cash muster-out rolls spent so far (read by the muster UI). */
  get musterCashUsed(): number { return this.muster.musterCashUsed; }
  /** Human-readable muster-out roll log (read by the muster / end UI). */
  get musterLog(): string[] { return this.muster.musterLog; }
  /** Persistent anagathics standing order (read + toggled by the term UI). */
  get anagathicsStandingOrder(): boolean {
    return this.anagathics.anagathicsStandingOrder;
  }
  set anagathicsStandingOrder(value: boolean) {
    this.anagathics.anagathicsStandingOrder = value;
  }

  /** Apparent age — the Aging-table line the character is on. Derived: the
   *  stored line (AnagathicsState) resolved against chronological age.
   *  Equals age until anagathics freezes it or doAging snapshots it. Read
   *  by the PDF / sheet; assigned by the aging and anagathics steps. */
  get apparentAge(): number {
    return this.anagathics.resolveApparentAge(this.age);
  }
  set apparentAge(value: number) {
    this.anagathics.apparentAgeLine = value;
  }
  /**
   * The edition this character was rolled under. Determines which service
   * map, cascade pools, and edition hooks apply. Stays fixed for the
   * character's lifetime — switching editions mid-chargen would invalidate
   * accumulated skills and benefits.
   */
  editionId: string = DEFAULT_EDITION_ID;
  /**
   * The character's homeworld profile, for editions (MT) that have a
   * homeworld step. Set by generateHomeworld() during character creation.
   * Tech code gates which careers are available; default skills are
   * granted based on tech and (later) service.
   */
  homeworld: Homeworld | null = null;
  /**
   * Choice mode. "auto" (default) preserves the original random-everywhere
   * behavior used by tests and the streamlined UI flow. "interactive" makes
   * cascade picks, weapon-benefit type/specific picks, and skill-table
   * selection defer to the UI via pendingChoices.
   */
  choiceMode: ChoiceMode = "auto";
  /**
   * Which chargen model drives this character (a chargen-model registry key).
   * The session dispatches every phase transition through the model registered
   * under this id. This "classic" initializer is only a pre-startCareer
   * placeholder: startCareer always overwrites it with the ACG model or the
   * edition's declared `defaultChargenModel` before any phase runs, so the
   * literal is never the final value in a real flow. Cloned by cloneCharacter's
   * Object.assign.
   */
  chargenModelId = "classic";
  /**
   * Choices waiting for user resolution. Each entry holds the apply-on-pick
   * closure; the session resolves it by re-running the paused action with
   * the picked option index appended to the decision cursor.
   */
  pendingChoices: PendingChoice<string>[] = [];
  /**
   * Execution-scoped decision cursor for event-sourced re-execution. The
   * session sets it before running an action; pickOrDefer consumes recorded
   * option indices synchronously (onResolve runs inline) until the cursor is
   * exhausted — the next interactive choice is the frontier, which queues on
   * pendingChoices and throws ChoicePendingError. Never persisted:
   * cloneCharacter always nulls it on the clone.
   */
  decisionCursor: DecisionCursor | null = null;

  // ---------- Advanced Character Generation (MT) ----------
  /**
   * Whether the character was rolled through Advanced Character Generation
   * rather than the basic per-term flow. ACG produces additional state
   * (branch, MOS, decorations, schools) that doesn't fit the basic sheet.
   * The PDF renderer branches on this to draw the ACG record sheet.
   */
  get useAcg(): boolean {
    return this.chargenModelId === "acg";
  }
  /** Pathway name within the edition's ACG block (mercenary/navy/scout/
   *  merchantPrince for MT). Null when useAcg is false. */
  acgPathway: string | null = null;
  /** Full ACG state — pathway, role, rank, per-term cycle, resume fields.
   *  Lazily initialized when ACG begins. */
  acgState: AcgState | null = null;
  /** Full Mongoose 2e chargen state — lazily created when the mongoose flow
   *  begins (null for CT/MT characters). */
  mongooseState: MongooseState | null = null;
  /** Set the first time a homeworld tech/law skill gate forces an override
   *  roll, so the cited homeworld-skill-restriction rule (MT PM p. 15) is
   *  surfaced once per character rather than on every restricted skill.
   *  Copied by cloneCharacter via Object.assign; applies to basic MT (no
   *  acgState) as well as ACG. */
  homeworldRestrictionNoteLogged = false;

  /** Non-null assertion helper for ACG pathway code. Pathway functions
   *  are only called when the character is on an ACG path, so acgState
   *  is guaranteed populated — but the field type allows null because
   *  basic-chargen characters never set it. Use this once per function
   *  to get a typed local `const acg = ch.requireAcgState()` and skip
   *  the `ch.acgState!.X` chains. */
  requireAcgState(): AcgState {
    if (!this.acgState) {
      throw new Error("requireAcgState called on non-ACG character");
    }
    return this.acgState;
  }

  /** Pathway-narrowed accessors. Throw if the character isn't on the
   *  expected pathway (or if the pathway-specific fields haven't been
   *  populated yet — e.g., requireMercenaryAcg before enlist sets
   *  combatArm). Use within pathway code so reads of pathway-specific
   *  fields (combatArm, fleet, division, lineType) are non-optional. */
  requireMercenaryAcg(): MercenaryAcgState {
    const acg = this.requireAcgState();
    assertPathway(acg, "mercenary");
    return acg;
  }
  requireNavyAcg(): NavyAcgState {
    const acg = this.requireAcgState();
    assertPathway(acg, "navy");
    return acg;
  }
  requireScoutAcg(): ScoutAcgState {
    const acg = this.requireAcgState();
    assertPathway(acg, "scout");
    return acg;
  }
  requireMerchantAcg(): MerchantAcgState {
    const acg = this.requireAcgState();
    assertPathway(acg, "merchantPrince");
    return acg;
  }

  /** Soft pathway-narrowed accessors — the non-throwing siblings of the
   *  require*Acg family. Return the narrowed variant, or null when the
   *  character isn't on that pathway (or isn't an ACG character at all).
   *  Used by generic hooks that fire regardless of pathway and must
   *  early-return on a mismatch instead of throwing. */
  tryMercenaryAcg(): MercenaryAcgState | null {
    return this.acgState?.pathway === "mercenary" ? this.acgState : null;
  }
  tryNavyAcg(): NavyAcgState | null {
    return this.acgState?.pathway === "navy" ? this.acgState : null;
  }
  tryScoutAcg(): ScoutAcgState | null {
    return this.acgState?.pathway === "scout" ? this.acgState : null;
  }
  tryMerchantAcg(): MerchantAcgState | null {
    return this.acgState?.pathway === "merchantPrince" ? this.acgState : null;
  }

  // Read-only ACG accessors. Convenient default-empty fallbacks for the
  // PDF renderer and UI components that may run before acgState is
  // initialized. Writers must go through ch.acgState directly (using
  // freshAcgState() if the field doesn't exist yet) — the old
  // lazy-init-on-set behavior was a footgun that silently materialized
  // an acgState whenever a test wrote `c.browniePoints = 0`.
  get acgBranch(): string | null {
    const acg = this.acgState;
    if (!acg) return null;
    if (acg.pathway === "mercenary") return (acg.branch || acg.combatArm) || null;
    if (acg.pathway === "navy") return acg.branch || null;
    if (acg.pathway === "scout") return acg.office || null;
    return acg.department || null;
  }
  get acgMos(): string | null {
    const acg = this.acgState;
    return acg?.pathway === "mercenary" ? (acg.mos || null) : null;
  }
  get decorations(): string[] {
    return this.acgState?.decorations ?? [];
  }
  get browniePoints(): number {
    return this.acgState?.browniePoints ?? 0;
  }
  get schoolsAttended(): string[] {
    return this.acgState?.schoolsAttended ?? [];
  }

  /**
   * Generic choice point. In auto mode, picks randomly from options and runs
   * the resolver immediately. In interactive mode, a previously-recorded
   * decision-cursor entry resolves the choice synchronously (onResolve runs
   * inline and execution continues); with the cursor exhausted (or absent),
   * the choice queues on pendingChoices and ChoicePendingError unwinds to the
   * session boundary, which snapshots the paused state. The session resumes
   * by re-running the whole action from its pre-action base with the picked
   * index appended to the cursor.
   */
  pickOrDefer(req: ChoiceRequest<string>): void {
    if (this.choiceMode === "auto") {
      const pool = req.preferred && req.preferred.length > 0
        ? req.preferred
        : req.options;
      req.onResolve(this, this.rng.pick(pool));
      return;
    }
    const cursor = this.decisionCursor;
    if (cursor && cursor.pos < cursor.resolutions.length) {
      const idx = cursor.resolutions[cursor.pos]!;
      cursor.pos += 1;
      const chosen = req.options[idx];
      if (chosen === undefined) {
        // A recorded index that no longer maps to an option means the
        // decision log and the re-executed flow have diverged — fail loudly
        // rather than silently mis-resolving the choice.
        throw new Error(
          `decision cursor: recorded option index ${idx} is out of range for ` +
          `choice "${req.label}" (${req.options.length} options) — ` +
          "corrupted or stale decision log",
        );
      }
      req.onResolve(this, chosen);
      return;
    }
    // Frontier: queue the choice and unwind to the session boundary.
    const id = genChoiceId();
    this.pendingChoices.push({ id, ...req });
    throw new ChoicePendingError(id);
  }

  /** Service definition for this character's current service key, looked up
   *  in this character's edition's service map. Throws if the service key is
   *  not part of the active edition — that's an edition-isolation violation
   *  we want to surface, not silently mask. */
  serviceDef(): ServiceDef {
    return this.editionService(this.service as ServiceKey);
  }

  /** Look up any service in this character's edition. */
  editionService(key: ServiceKey): ServiceDef {
    const map = getEditionServices(this.editionId);
    const def = map[key];
    if (!def) {
      throw new Error(
        `Service "${key}" is not part of edition "${this.editionId}"`,
      );
    }
    return def;
  }

  /**
   * Generate a homeworld for the character per MT pp. 12-13. No-op for
   * editions (CT) that don't have a homeworld block. Should be called
   * AFTER attribute rolls but BEFORE enlistment / beginAcg.
   */
  generateHomeworld(): void {
    if (!editionHasHomeworld(this.editionId)) return;
    generateAndApplyHomeworld(this);
  }

  /**
   * Attempt a pre-career option (College, Naval/Military/Merchant
   * Academy, Medical or Flight school). Returns the structured result
   * including any auto-enlistment pathway (OTC → mercenary; NOTC → navy;
   * academy graduation → that academy's career).
   *
   * Mutates Character state (skills, attributes, age, brownie points).
   * Callers should check result.autoEnlistPathway and route to beginAcg
   * with the appropriate options, OR call this multiple times for
   * Medical/Flight school after honors.
   */
  doPreCareer(option: PreCareerOption): PreCareerOutcome {
    if (!this.useAcg) {
      throw new Error("doPreCareer is only valid in ACG mode");
    }
    // Lazy-init acgState so pre-career can run before pathway is chosen.
    // The pathway defaults to mercenary; beginAcg overwrites it later.
    if (!this.acgState) {
      this.acgState = freshAcgState(
        (this.acgPathway as "mercenary" | "navy" | "scout" | "merchantPrince") ?? "mercenary",
      );
    }
    // Record the attempt eagerly. attemptPreCareer may throw
    // ChoicePendingError mid-flight (OTC commission branch picker etc.)
    // — without an eager record the UI's "tried(option)" gate stays
    // false, the school button stays visible, and the player can
    // re-trigger the same pre-career roll repeatedly.
    this.acgState.schoolsAttempted = this.acgState.schoolsAttempted ?? [];
    if (!this.acgState.schoolsAttempted.includes(option)) {
      this.acgState.schoolsAttempted.push(option);
    }
    const result = attemptPreCareer(this, option);
    applyPreCareerResult(this, option, result);
    return {
      autoEnlistPathway: result.autoEnlistPathway,
      admitted: result.admitted,
      honors: result.honors,
      graduated: result.graduated,
      commissioned: result.commissioned,
      notes: result.notes,
    };
  }

  /** Begin Advanced Character Generation — implementation in chargen/enlistment.ts. */
  beginAcg(
    pathway: "mercenary" | "navy" | "scout" | "merchantPrince",
    options: BeginAcgOptions = {},
  ): void {
    beginAcgImpl(this, pathway, options);
  }

  // ---------- attributes / skills / benefits ----------

  getAttrString(): string {
    return (
      extendedHex(this.attributes.strength) +
      extendedHex(this.attributes.dexterity) +
      extendedHex(this.attributes.endurance) +
      extendedHex(this.attributes.intelligence) +
      extendedHex(this.attributes.education) +
      extendedHex(this.attributes.social)
    );
  }

  checkSkill(skill: string): number {
    for (let i = 0; i < this.skills.length; i++) {
      if (this.skills[i]![0] === skill) return i;
    }
    return -1;
  }

  checkSkillLevel(skill: string, level: number): boolean {
    const i = this.checkSkill(skill);
    return i >= 0 && this.skills[i]![1] >= level;
  }

  addSkill(skill: string, skillLevel = 1, source?: string) {
    const i = this.checkSkill(skill);
    if (i >= 0) {
      const entry = this.skills[i]!;
      entry[1] += skillLevel;
      this.log(ev.skillImproved(skill, entry[1], source));
    } else {
      this.skills.push([skill, skillLevel]);
      this.log(ev.skillLearned(skill, skillLevel, source));
    }
  }

  /** Sum of all skill levels. PM p. 39: this may not exceed Int+Edu. */
  totalSkillLevels(): number {
    let sum = 0;
    for (const [, lvl] of this.skills) sum += lvl;
    return sum;
  }

  /** Sum of the attributes named in rules.skillCap.attributes — the MT cap
   *  on total skill levels (PM p. 15). Operands are data, not code. Returns
   *  0 for editions with no skillCap block (CT); callers gate on block
   *  presence via enforceSkillCap. */
  skillCap(): number {
    const spec = getEdition(this.editionId).rules.skillCap;
    let sum = 0;
    for (const a of spec?.attributes ?? []) sum += this.attributes[a as AttributeKey];
    return sum;
  }

  /** Enforce the Int+Edu skill cap (PM p. 39) — see chargen/skillCap. */
  enforceSkillCap(): void {
    enforceSkillCapImpl(this);
  }

  improveAttribute(attrib: AttributeKey, delta = 1, source?: string) {
    this.attributes[attrib] += delta;
    // PM/TTB p. 17 caps + per-edition socialMin override — sourced from
    // rules.attributeCaps in the edition JSON.
    const caps = getEdition(this.editionId).rules.attributeCaps;
    const max = requireRule(caps?.max, "rules.attributeCaps.max", "PM/TTB p. 17");
    if (this.attributes[attrib] > max) {
      // Post-state in the ev.attributeChange below shows the capped value.
      this.attributes[attrib] = max;
    }
    const socialMin = requireRule(
      caps?.socialMin, "rules.attributeCaps.socialMin", "PM/TTB p. 17",
    );
    const min = requireRule(caps?.min, "rules.attributeCaps.min", "PM/TTB p. 17");
    if (attrib === "social" && this.attributes[attrib] < socialMin) {
      this.attributes[attrib] = socialMin;
    } else if (this.attributes[attrib] < min) {
      this.attributes[attrib] = min;
    }
    // The displayed delta is the requested change, not the post-clamp
    // change; the cap-warning log line above is what tells the reader
    // a clamp happened.
    const now = this.chargenModelId === "mongoose"
      ? String(this.attributes[attrib])
      : extendedHex(this.attributes[attrib]);
    this.log(ev.attributeChange(attrib, delta, `now ${now}`, source));
  }

  addBenefit(benefit: string) {
    this.benefits.push(benefit);
    // Silent: callers are responsible for the history entry. Muster
    // cells emit ev.musterBenefit before applyCell calls us, cascade
    // weapon benefits emit ev.cascadePick, decorations emit
    // ev.decoration, and standalone benefits (retirement pay, scout
    // detached duty, free trader ship) log explicitly at their call
    // site. Logging here too produced a duplicate line in verbose mode.
  }

  // ---------- single logging API ----------
  //
  // All chargen history flows through `log(event)`. Every push records a
  // structured `events[]` entry and (subject to showHistory) mirrors the
  // formatted string into the legacy `history[]` array so existing
  // consumers (PDF sheet, tests) keep working. The convenience wrappers
  // below construct common event shapes for callers that don't want to
  // import the event factory; they are thin shims over `log()`, not
  // independent paths.

  /** Canonical single entry point for all chargen history. Pushes to
   *  the typed `events` array; `history` derives from it on read. */
  log(e: HistoryEvent) {
    this.events.push(e);
  }

  // Weapon-benefit cascades — implementations in chargen/weaponBenefits.ts.
  doBladeBenefit(): void { doBladeBenefitImpl(this); }
  doGunBenefit(): void { doGunBenefitImpl(this); }
  doWeaponBenefit(): void { doWeaponBenefitImpl(this); }

  // ---------- enlistment ----------

  /** Basic-chargen enlistment — implementation in chargen/enlistment.ts. */
  doEnlistment(method: string): ServiceKey {
    return doEnlistmentImpl(this, method);
  }

  /** Apply the joined service's startAge from edition data. */
  applyServiceStartAge(svc: ServiceKey): void {
    applyServiceStartAgeImpl(this, svc);
  }

  // ---------- service term ----------

  /** Run one service term — implementation in chargen/term.ts. */
  doServiceTermStep(): void {
    doServiceTermStepImpl(this);
  }

  // ---------- reenlistment ----------

  /** End-of-term reenlistment — implementation in chargen/reenlist.ts. */
  doReenlistmentStep(): void {
    doReenlistmentStepImpl(this);
  }

  /** True when this character qualifies for retirement: at least the
   *  edition's eligibleAfterCompletedTerm and not in the excludedServices
   *  list (MT excludes Barbarians, Pirates, Rogues, Scouts per PM p. 17). */
  isRetirementEligible(): boolean {
    const retirement = getEdition(this.editionId).rules.retirement;
    const minTerms = requireRule(
      retirement?.eligibleAfterCompletedTerm,
      "rules.retirement.eligibleAfterCompletedTerm", "TTB p. 18 / PM p. 17",
    );
    const excluded = requireRule(
      retirement?.excludedServices,
      "rules.retirement.excludedServices", "TTB p. 18 / PM p. 17",
    );
    if (this.qualifyingRetirementTerms() < minTerms) return false;
    if (excluded.includes(String(this.service))) return false;
    return true;
  }

  /** Terms that count toward retirement eligibility and pension. MT
   *  (rules.retirement.anagathicTermsExcluded) excludes terms whose muster
   *  benefits were forfeited to anagathics, so the `retired` flag and the
   *  pension payment stay consistent (both must use this). */
  qualifyingRetirementTerms(): number {
    const retirement = getEdition(this.editionId).rules.retirement;
    if (retirement?.anagathicTermsExcluded) {
      return this.terms - (this.anagathics.anagathicsBenefitForfeitedTerms ?? 0);
    }
    return this.terms;
  }

  /** Years per full term of service (rules.survival.fullTermYears; both
   *  editions declare it). The term-begin age bump, aging breakpoints, and
   *  the survival short-term rewind must all use this same value. */
  fullTermYears(): number {
    return requireRule(
      getEdition(this.editionId).rules.survival?.fullTermYears,
      "rules.survival.fullTermYears", "TTB p. 18 / PM p. 45",
    );
  }

  /** PM p. 16 (lines 939-943): a character is disabled — and must muster
   *  out at the next term boundary — when any of these conditions hold:
   *    - age has reached the aging-table line declared in
   *      rules.disability.atAgeLine
   *    - any one of the listed physical characteristics has dropped to
   *      rules.disability.physicalAttributeAtMost
   *    - the sum of the physical characteristics is at or below
   *      rules.disability.sumPhysicalAttributesAtMost
   *  Editions without a `rules.disability` block (CT) return false. */
  isDisabled(): { disabled: boolean; reasons: string[] } {
    const d = getEdition(this.editionId).rules.disability;
    if (!d) return { disabled: false, reasons: [] };
    const physical = (d.physicalAttributes ?? []) as AttributeKey[];
    const reasons: string[] = [];
    if (d.atAgeLine !== undefined && this.age >= d.atAgeLine) {
      reasons.push(`age ${d.atAgeLine}+`);
    }
    if (d.physicalAttributeAtMost !== undefined) {
      for (const a of physical) {
        if (this.attributes[a] <= d.physicalAttributeAtMost) {
          reasons.push(`${a} at most ${d.physicalAttributeAtMost}`);
        }
      }
    }
    if (d.sumPhysicalAttributesAtMost !== undefined) {
      const sum = physical.reduce((acc, a) => acc + this.attributes[a], 0);
      if (sum <= d.sumPhysicalAttributesAtMost) {
        reasons.push(`sum of ${physical.join("+")} = ${sum}, at most ${d.sumPhysicalAttributesAtMost}`);
      }
    }
    return { disabled: reasons.length > 0, reasons };
  }

  // ---------- anagathics (implementations in chargen/anagathics.ts) ----------

  tryAnagathics(allowRetry = true): boolean {
    return tryAnagathicsImpl(this, allowRetry);
  }
  preSurvivalAnagathicsHook(): void {
    preSurvivalAnagathicsHookImpl(this);
  }
  discontinueAnagathics(): void {
    discontinueAnagathicsImpl(this);
  }

  // ---------- aging (implementations in chargen/aging.ts) ----------

  ageAttribute(attrib: AttributeKey, req: number, reduction: number): void {
    ageAttributeImpl(this, attrib, req, reduction);
  }
  doAging(): void {
    doAgingImpl(this);
  }

  // ---------- muster out ----------

  /** Map ACG rank state into the basic character.rank field used by muster
   *  DMs and rank bands. Officer O1..O6 → rank 1..6; O7+ caps at 6. Enlisted
   *  ranks remain 0 (basic chargen has no enlisted rank concept).
   *  Also applies the SEH automatic +1 rank if pending. Idempotent: safe
   *  to call before muster regardless of pathway. */
  /** ACG rank → basic-chargen rank projection — implementation in chargen/muster.ts. */
  finalizeAcgRankForMuster(): void {
    finalizeAcgRankForMusterImpl(this);
  }

  /** Number of muster-out rolls — implementation in chargen/muster.ts. */
  musterOutRolls(): number {
    return musterOutRollsImpl(this);
  }

  /** One muster-out cash roll. */
  musterOutCash(cashDM: number): void {
    musterOutCashImpl(this, cashDM);
  }

  /** One muster-out benefit roll. */
  musterOutBenefit(benefitsDM: number): void {
    musterOutBenefitImpl(this, benefitsDM);
  }

  /** Retirement-pay + per-pathway finalizers. */
  musterOutPay(): void {
    musterOutPayImpl(this);
  }

  // ---------- titles ----------

  getNobleTitle(): string {
    const titles = getEdition(this.editionId).rules.nobleTitles;
    const entry = titles?.[String(this.attributes.social)];
    if (!entry || typeof entry === "string") return "";
    return (this.gender === "female" ? entry.female : entry.male) ?? "";
  }

  // ---------- display ----------

  toString(): string {
    let out = formatCharacterSheet(this);
    if (this.showHistory !== "none" && this.history.length > 0) {
      out += "\nService History:\n" + this.history.join("\n") + "\n";
    }
    return out;
  }
}

/**
 * Produce a deep-enough copy that React state updates see a fresh top-level
 * reference and per-instance mutable arrays/objects can't leak across copies.
 */
export function cloneCharacter(ch: Character): Character {
  const next = Object.assign(Object.create(Character.prototype), ch) as Character;
  // rng is a per-instance MUTABLE stream (its state advances on every draw).
  // Clone it so the copy is independent: drawing on the clone must not advance
  // the source snapshot's stream (the immutable-snapshot contract session.ts
  // relies on, and the seeded-determinism invariant). Rng.clone() forks an
  // independent stream at the same position.
  next.rng = ch.rng.clone();
  next.attributes = { ...ch.attributes };
  next.skills = ch.skills.map(([n, l]) => [n, l] as Skill);
  next.benefits = [...ch.benefits];
  // Shallow-clone the array AND each event payload. Today event objects
  // are immutable in practice but agingSave carries a `dice` tuple and
  // future event kinds may grow nested arrays/objects — copying defends
  // against a mutation in the clone leaking back into the original.
  next.events = ch.events.map((e) => ({ ...e }));
  next.muster = ch.muster.clone();
  next.anagathics = ch.anagathics.clone();
  // pendingChoices must be cloned: workflow handlers in app/page.tsx mutate
  // the clone (via pickOrDefer → pendingChoices.push) before committing.
  // A shared reference leaks queued cascades back to the unrelated original
  // when the handler bails on ChoicePendingError, stacking stale choices
  // across stages.
  next.pendingChoices = [...ch.pendingChoices];
  // The decision cursor is execution-scoped: it lives only for the duration
  // of one session action's (re-)execution and must never leak into a stored
  // snapshot or a re-run base.
  next.decisionCursor = null;
  // chargenStatus is a discriminated union; the variant objects are
  // immutable per the helpers, but freshly cloning avoids any chance of
  // shared-reference aliasing on future field additions.
  next.chargenStatus = { ...ch.chargenStatus };
  if (ch.homeworld) next.homeworld = { ...ch.homeworld };
  // acgState contains nested arrays and objects (assignmentHistory,
  // schoolsAttended, decorations, honorsGraduations, etc.). The UI
  // mutates these via setters and the awards / school helpers; a shared
  // reference leaks mutations back into the snapshot. structuredClone
  // deep-copies all serializable shapes.
  if (ch.acgState) next.acgState = structuredClone(ch.acgState);
  if (ch.mongooseState) next.mongooseState = structuredClone(ch.mongooseState);
  return next;
}
