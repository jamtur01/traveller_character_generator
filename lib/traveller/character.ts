// The Character class: rolls, terms, skills, muster-out. Service-specific
// tables live in `./services/*` and are looked up via the `s` registry inside
// method bodies (avoids module-load cycles).

import { arnd, rndInt, roll } from "./random";
import type { ChoiceMode, ChoiceRequest, PendingChoice } from "./engine/choices";
import { genChoiceId, ChoicePendingError } from "./engine/choices";
import type { HistoryEvent } from "./history";
import { event as ev, formatEvent } from "./history";
import type {
  AcgState, MercenaryAcgState, NavyAcgState,
  ScoutAcgState, MerchantAcgState,
} from "./engine/acg/state";
import {
  isMercenaryAcg, isNavyAcg, isScoutAcg, isMerchantAcg, freshAcgState,
} from "./engine/acg/state";
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
import { formatCharacterSheet } from "./sheet";

/** Roll the six initial 2d6 attributes. Consumes 12 Math.random calls
 *  — kept as a free helper so tests can inspect/replace it independent
 *  of the Character constructor. */
function rollInitialAttributes(): Attributes {
  return {
    strength: roll(2),
    dexterity: roll(2),
    endurance: roll(2),
    intelligence: roll(2),
    education: roll(2),
    social: roll(2),
  };
}

/** Options for the Character constructor. Tests that need deterministic
 *  attributes pass them in here instead of rolling 12 dice via the
 *  default field initializer and overriding afterward. */
export interface CharacterOptions {
  attributes?: Attributes;
}

export class Character {
  /** Construct a fresh character. If `opts.attributes` is provided,
   *  skips the 12-dice initial roll — tests should prefer this over
   *  installing a Math.random mock pre-construction or overwriting
   *  attributes post-construction. Other field initializers
   *  (gender / name) still consume randomness — they're a 2-call
   *  footprint vs. attributes' 12. */
  constructor(opts: CharacterOptions = {}) {
    this.attributes = opts.attributes ?? rollInitialAttributes();
  }

  age = 18;
  gender: Gender = generateGender();
  name: string = generateName(this.gender);
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
  mortgage = 40;
  mortgages = 0;
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

  /** Remembers whether muster-out followed a retirement (vs. a court-
   *  martial discharge or forced muster). Read by the `retired` getter
   *  so retirement-pension eligibility persists into the muster-out
   *  phase. Written by endChargenRetired / endChargenDischarged. */
  endedAsRetired = false;

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
   *  status="retired" but endedAsRetired=false. */
  get retired(): boolean {
    return this.endedAsRetired;
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
    this.endedAsRetired = withPension ?? this.isRetirementEligible();
    this.chargenStatus = { kind: "retired", reason };
    this.log(ev.endGeneration("retired", reason));
  }

  /** Court-martial discharge — chargen ends, but the character continues
   *  to muster-out (with the appropriate penalty flags on acgState). No
   *  pension. */
  endChargenDischarged(): void {
    this.endedAsRetired = false;
    this.chargenStatus = { kind: "retired", reason: "discharged" };
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
  forceTable = false;
  forceTableIndex = 1;
  musterCashUsed = 0;
  musterRolls = 0;
  /** Transient UI flag: the current muster roll (cash or benefit) paused
   *  on a cascade or nested choice and hasn't completed yet. Set by
   *  the muster-out UI handler when a ChoicePendingError is caught;
   *  cleared by the resolvePending handler after the entire choice
   *  chain drains. While true, musterRolls must NOT be decremented —
   *  the roll's player-visible work isn't finished. */
  pendingMusterRoll = false;
  /** Human-readable log of each muster-out roll's outcome. */
  musterLog: string[] = [];
  /**
   * Anagathics state (MT PM p. 15). Apparent age is what the Aging table
   * uses each term; chronological `age` advances normally. Frozen each
   * term anagathics supply is maintained; advances when supply is missing.
   */
  onAnagathics = false;
  /** Per-term flag: anagathics taken this term. -1 survival DM, no muster
   *  benefit roll this term. Player must specify before survival. */
  anagathicsActiveThisTerm = false;
  /** Per-term flag: character lost the anagathics supply this term — double
   *  saving throws on aging. */
  anagathicsWithdrawalThisTerm = false;
  /** True once the character has ever opted into anagathics: caps cash
   *  table rolls at 2 permanently. */
  anagathicsEverTaken = false;
  /** Apparent age — the Aging-table line the character is on. Defaults to
   *  chronological age; diverges when anagathics is active. */
  /** Private backing for apparentAge. Defaults to 0; the getter
   *  reports `age` until doAging or anagathics explicitly assigns. */
  private _apparentAge = 0;
  /** Apparent age — the Aging-table line the character is on. Equals
   *  chronological age until anagathics freezes it or doAging snapshots
   *  the value. Getter ensures UI / PDF reads before the first aging
   *  term don't see 0. */
  get apparentAge(): number {
    return this._apparentAge === 0 ? this.age : this._apparentAge;
  }
  set apparentAge(v: number) {
    this._apparentAge = v;
  }
  /** Initialize the backing field of apparentAge to the current age if
   *  it's still the default-zero sentinel. Idempotent. Called by the
   *  aging step so that a later anagathics opt-in can freeze the field
   *  from the value at this point rather than from chronological age. */
  snapshotApparentAge(): void {
    if (this._apparentAge === 0) this._apparentAge = this.age;
  }
  /** Count of terms in which anagathics was active — those terms forfeit
   *  the muster-out benefit roll (PM p. 15). */
  anagathicsBenefitForfeitedTerms = 0;
  /** Per-term flag: player has declared intent to use anagathics this term.
   *  Set before survival; cleared at the start of each term. When true,
   *  survival receives the -1 (-2 for nobles) DM whether or not the supply
   *  is later found. The pre-survival hook reads this and calls tryAnagathics. */
  wantsAnagathicsThisTerm = false;
  /** Persistent player preference: re-assert anagathics intent each term
   *  once eligible. The pre-survival hook copies this into
   *  wantsAnagathicsThisTerm at the start of each term. */
  anagathicsStandingOrder = false;
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
   * Choices waiting for user resolution. Each entry holds the apply-on-pick
   * closure; the UI calls resolveChoice(id, optionIdx) when the user picks.
   */
  pendingChoices: PendingChoice<string>[] = [];

  // ---------- Advanced Character Generation (MT) ----------
  /**
   * Whether the character was rolled through Advanced Character Generation
   * rather than the basic per-term flow. ACG produces additional state
   * (branch, MOS, decorations, schools) that doesn't fit the basic sheet.
   * The PDF renderer branches on this to draw the ACG record sheet.
   */
  useAcg = false;
  /** Pathway name within the edition's ACG block (mercenary/navy/scout/
   *  merchantPrince for MT). Null when useAcg is false. */
  acgPathway: string | null = null;
  /** Full ACG state — pathway, role, rank, per-term cycle, resume fields.
   *  Lazily initialized when ACG begins. */
  acgState: AcgState | null = null;

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
    if (!isMercenaryAcg(acg)) {
      throw new Error(`Expected mercenary acgState, got pathway=${acg.pathway}`);
    }
    return acg;
  }
  requireNavyAcg(): NavyAcgState {
    const acg = this.requireAcgState();
    if (!isNavyAcg(acg)) {
      throw new Error(`Expected navy acgState, got pathway=${acg.pathway}`);
    }
    return acg;
  }
  requireScoutAcg(): ScoutAcgState {
    const acg = this.requireAcgState();
    if (!isScoutAcg(acg)) {
      throw new Error(`Expected scout acgState, got pathway=${acg.pathway}`);
    }
    return acg;
  }
  requireMerchantAcg(): MerchantAcgState {
    const acg = this.requireAcgState();
    if (!isMerchantAcg(acg)) {
      throw new Error(`Expected merchantPrince acgState, got pathway=${acg.pathway}`);
    }
    return acg;
  }

  // Read-only ACG accessors. Convenient default-empty fallbacks for the
  // PDF renderer and UI components that may run before acgState is
  // initialized. Writers must go through ch.acgState directly (using
  // freshAcgState() if the field doesn't exist yet) — the old
  // lazy-init-on-set behavior was a footgun that silently materialized
  // an acgState whenever a test wrote `c.browniePoints = 0`.
  get acgBranch(): string | null {
    if (!this.acgState) return null;
    return this.acgState.branch ?? this.acgState.combatArm ?? this.acgState.office
      ?? this.acgState.department ?? null;
  }
  get acgMos(): string | null {
    return this.acgState?.mos ?? null;
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
   * the resolver immediately. In interactive mode, queues a PendingChoice
   * and returns without applying — the UI is expected to call resolveChoice
   * later.
   */
  pickOrDefer(req: ChoiceRequest<string>): void {
    if (this.choiceMode === "auto") {
      const pool = req.preferred && req.preferred.length > 0
        ? req.preferred
        : req.options;
      req.onResolve(this, arnd(pool));
      return;
    }
    // Interactive mode: queue the choice and signal the runner to pause.
    // The ACG runner catches ChoicePendingError, preserves the current
    // yearStep, and bails. The UI resolves the choice via resolveChoice
    // (which runs the queued closure), then re-invokes the runner to
    // continue the year from where it paused.
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
  doPreCareer(option: PreCareerOption): {
    autoEnlistPathway: "mercenary" | "navy" | "scout" | "merchantPrince" | null;
    admitted: boolean;
    honors: boolean;
    graduated: boolean;
    commissioned: boolean;
    notes: string[];
  } {
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

  /** Apply the user's pick for a pending choice. */
  resolveChoice(id: string, optionIdx: number): void {
    const idx = this.pendingChoices.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const choice = this.pendingChoices[idx]!;
    const chosen = choice.options[optionIdx];
    if (chosen === undefined) return;
    this.pendingChoices.splice(idx, 1);
    choice.onResolve(this, chosen);
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

  /** PM resume field 4 ("Equipment Qualified On"): every weapon/vehicle
   *  skill at level ≥ 1. Cached on acgState when present so the sheet
   *  renderer doesn't recompute. */
  computeEquipmentQualifiedOn(): string[] {
    const equipKeywords = [
      "Combat", "Rifle", "Pistol", "Shotgun", "Gunnery", "Vehicle",
      "Aircraft", "Watercraft", "Pilot", "Ship's Boat", "Vacc Suit",
      "Tactics", "Demolitions", "Heavy Weapons", "FA Gunner", "Blade",
      "Gun", "Bow", "Battle Dress",
    ];
    const out: string[] = [];
    for (const [name, level] of this.skills) {
      if (level < 1) continue;
      if (equipKeywords.some((kw) => name.includes(kw))) {
        out.push(`${name}-${level}`);
      }
    }
    if (this.acgState) {
      this.acgState.equipmentQualifiedOn = out;
    }
    return out;
  }

  /** Physical age (PM p. 15 anagathics: "Age 34 (50)"). Equal to chronological
   *  age unless the character has been on anagathics or Frozen Watch. */
  getPhysicalAge(): number {
    const acgOffset = this.acgState?.physicalAgeOffset ?? 0;
    return Math.max(0, this.age + acgOffset);
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

  whichSkillTable(): number {
    const table = this.forceTable
      ? this.forceTableIndex
      : rndInt(1, 3) + (this.attributes.education >= 8 ? 1 : 0);
    return table;
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

  /** Int+Edu — the MT cap on total skill levels. */
  skillCap(): number {
    return this.attributes.intelligence + this.attributes.education;
  }

  /** Enforce the Int+Edu skill cap (PM p. 39) — see chargen/skillCap. */
  enforceSkillCap(): void {
    enforceSkillCapImpl(this);
  }

  improveAttribute(attrib: AttributeKey, delta = 1) {
    this.attributes[attrib] += delta;
    // PM/TTB p. 17 caps + per-edition socialMin override — sourced from
    // rules.attributeCaps in the edition JSON.
    const caps = getEdition(this.editionId).rules.attributeCaps;
    const max = caps?.max ?? 15;
    if (this.attributes[attrib] > max) {
      // Post-state in the ev.attributeChange below shows the capped value.
      this.attributes[attrib] = max;
    }
    const socialMin = caps?.socialMin ?? 1;
    const min = caps?.min ?? 0;
    if (attrib === "social" && this.attributes[attrib] < socialMin) {
      this.attributes[attrib] = socialMin;
    } else if (this.attributes[attrib] < min) {
      this.attributes[attrib] = min;
    }
    // The displayed delta is the requested change, not the post-clamp
    // change; the cap-warning log line above is what tells the reader
    // a clamp happened.
    this.log(ev.attributeChange(
      attrib, delta,
      `now ${extendedHex(this.attributes[attrib])}`,
    ));
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
    const minTerms = retirement?.eligibleAfterCompletedTerm ?? 5;
    const excluded = retirement?.excludedServices ?? ["scouts", "other"];
    if (this.terms < minTerms) return false;
    if (excluded.includes(String(this.service))) return false;
    return true;
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
      reasons.push(`age ≥ ${d.atAgeLine}`);
    }
    if (d.physicalAttributeAtMost !== undefined) {
      for (const a of physical) {
        if (this.attributes[a] <= d.physicalAttributeAtMost) {
          reasons.push(`${a} ≤ ${d.physicalAttributeAtMost}`);
        }
      }
    }
    if (d.sumPhysicalAttributesAtMost !== undefined) {
      const sum = physical.reduce((acc, a) => acc + this.attributes[a], 0);
      if (sum <= d.sumPhysicalAttributesAtMost) {
        reasons.push(`sum of ${physical.join("+")} = ${sum} ≤ ${d.sumPhysicalAttributesAtMost}`);
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
export function cloneCharacter(c: Character): Character {
  const next = Object.assign(Object.create(Character.prototype), c) as Character;
  next.attributes = { ...c.attributes };
  next.skills = c.skills.map(([n, l]) => [n, l] as Skill);
  next.benefits = [...c.benefits];
  // Shallow-clone the array AND each event payload. Today event objects
  // are immutable in practice but agingSave carries a `dice` tuple and
  // future event kinds may grow nested arrays/objects — copying defends
  // against a mutation in the clone leaking back into the original.
  next.events = c.events.map((e) => ({ ...e }));
  next.musterLog = [...c.musterLog];
  // pendingChoices must be cloned: workflow handlers in app/page.tsx mutate
  // the clone (via pickOrDefer → pendingChoices.push) before committing.
  // A shared reference leaks queued cascades back to the unrelated original
  // when the handler bails on ChoicePendingError, stacking stale choices
  // across stages.
  next.pendingChoices = [...c.pendingChoices];
  // chargenStatus is a discriminated union; the variant objects are
  // immutable per the helpers, but freshly cloning avoids any chance of
  // shared-reference aliasing on future field additions.
  next.chargenStatus = { ...c.chargenStatus };
  if (c.homeworld) next.homeworld = { ...c.homeworld };
  // acgState contains nested arrays and objects (assignmentHistory,
  // schoolsAttended, decorations, honorsGraduations, etc.). The UI
  // mutates these via setters and the awards / school helpers; a shared
  // reference leaks mutations back into the snapshot. structuredClone
  // deep-copies all serializable shapes.
  if (c.acgState) next.acgState = structuredClone(c.acgState);
  return next;
}
