// The Character class: rolls, terms, skills, muster-out. Service-specific
// tables live in `./services/*` and are looked up via the `s` registry inside
// method bodies (avoids module-load cycles).

import { arnd, rndInt, roll } from "./random";
import type { ChoiceMode, ChoiceRequest, PendingChoice } from "./engine/choices";
import { genChoiceId, ChoicePendingError } from "./engine/choices";
import { cascadePoolByKey } from "./engine/cascadeMap";
import type { HistoryEvent } from "./history";
import { event as ev, formatEvent } from "./history";
import type { AcgState } from "./engine/acg/types";
import {
  editionHasHomeworld,
  generateAndApplyHomeworld, type Homeworld,
} from "./engine/homeworld";
import {
  applyPreCareerResult, attemptPreCareer, type PreCareerOption,
} from "./engine/acg/preCareer";
import { generateGender, generateName } from "./names";
import { attrShort, extendedHex } from "./formatting";
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

export class Character {
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
   *  given level (defaults to this.showHistory). `none` matches the
   *  legacy filter semantics — events accumulate but the display gate
   *  (toString / sheet rendering) hides them. */
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
  attributes: Attributes = {
    strength: roll(2),
    dexterity: roll(2),
    endurance: roll(2),
    intelligence: roll(2),
    education: roll(2),
    social: roll(2),
  };
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
  forceTable = false;
  forceTableIndex = 1;
  musterCashUsed = 0;
  musterRolls = 0;
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
  apparentAge = 0;
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

  // Accessor surfaces for the PDF renderer / UI — these read/write
  // through acgState. The setters lazy-init acgState with a default
  // mercenary pathway so existing callers that poke at acgBranch /
  // acgMos / decorations / browniePoints / schoolsAttended don't crash.
  // (The ACG runner overwrites acgState.pathway with the real pathway
  // during enlistment, so the default is harmless.)
  private ensureAcgState(): AcgState {
    if (!this.acgState) {
      // Inline default to avoid a circular import on freshAcgState.
      this.acgState = {
        pathway: (this.acgPathway as AcgState["pathway"]) ?? "mercenary",
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
    return this.acgState;
  }

  get acgBranch(): string | null {
    if (!this.acgState) return null;
    return this.acgState.branch ?? this.acgState.combatArm ?? this.acgState.office
      ?? this.acgState.department ?? null;
  }
  set acgBranch(v: string | null) {
    if (v === null) {
      if (this.acgState) delete this.acgState.branch;
      return;
    }
    this.ensureAcgState().branch = v;
  }
  get acgMos(): string | null {
    return this.acgState?.mos ?? null;
  }
  set acgMos(v: string | null) {
    if (v === null) {
      if (this.acgState) delete this.acgState.mos;
      return;
    }
    this.ensureAcgState().mos = v;
  }
  get decorations(): string[] {
    return this.acgState?.decorations ?? [];
  }
  set decorations(v: string[]) {
    this.ensureAcgState().decorations = v;
  }
  get browniePoints(): number {
    return this.acgState?.browniePoints ?? 0;
  }
  set browniePoints(v: number) {
    this.ensureAcgState().browniePoints = v;
  }
  get schoolsAttended(): string[] {
    return this.acgState?.schoolsAttended ?? [];
  }
  set schoolsAttended(v: string[]) {
    this.ensureAcgState().schoolsAttended = v;
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
    if (!this.acgState) {
      // Lazy-init acgState so pre-career can run before pathway is chosen.
      this.acgState = {
        pathway: "mercenary", rankCode: "E1", isOfficer: false,
        year: 1, currentAssignment: null, inCommand: false,
        justRetained: false, retainedAssignment: null,
        promotedThisTerm: false, injuredThisYear: false,
        assignmentHistory: [], combatRibbons: 0, commandClusters: 0,
        schoolsAttended: [], decorations: [], browniePoints: 0,
        browniePointsSpent: 0, decorationDmStrategy: 0,
      };
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

  /**
   * Enforce the Int+Edu skill cap (PM p. 39). Called after each term's
   * skill rolls. In auto mode, reduces the most-recently-acquired skill
   * level repeatedly until the total fits the cap. In interactive mode,
   * queues a `reduceSkill` choice for the player to pick which skill
   * level to drop; recurses until under cap.
   *
   * No-op for editions without a homeworld rules block (CT).
   */
  enforceSkillCap(): void {
    const ed = getEdition(this.editionId);
    if (!ed.rules.skillCap) return;
    const cap = this.skillCap();
    const total = this.totalSkillLevels();
    if (total <= cap) return;
    const excess = total - cap;
    if (this.choiceMode === "auto") {
      let remaining = excess;
      while (remaining > 0 && this.skills.length > 0) {
        const last = this.skills[this.skills.length - 1]!;
        if (last[1] > 1) {
          last[1] -= 1;
          this.log(ev.skillReduced(last[0], last[1], "Int+Edu cap"));
        } else {
          this.skills.pop();
          this.log(ev.skillForfeited(last[0], "Int+Edu cap"));
        }
        remaining -= 1;
      }
      return;
    }
    const options = this.skills.map(([n, l]) => `${n}-${l}`);
    this.pickOrDefer({
      kind: "reduceSkill",
      label: `Skill total ${total} exceeds Int+Edu cap ${cap}. Pick a skill to reduce by 1 (${excess} reduction${excess === 1 ? "" : "s"} needed).`,
      options,
      context: { source: "skillCap", excess, cap, total },
      onResolve: (c, chosen) => {
        const name = chosen.replace(/-\d+$/, "");
        const i = c.checkSkill(name);
        if (i < 0) return;
        const entry = c.skills[i]!;
        if (entry[1] > 1) {
          entry[1] -= 1;
          c.log(ev.skillReduced(name, entry[1], "Int+Edu cap"));
        } else {
          c.skills.splice(i, 1);
          c.log(ev.skillForfeited(name, "Int+Edu cap"));
        }
        c.enforceSkillCap();
      },
    });
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
    // The benefit name is already announced by the preceding event
    // (ev.musterBenefit for muster cells, ev.cascadePick for weapon
    // benefits, ev.decoration for award-conferred benefits). Standalone
    // benefits — retirement pay, scout detached duty stipend, free
    // trader ship from ACG — emit their own simple-level event at the
    // call site.
    this.log(ev.raw(benefit, "verbose"));
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

  /**
   * Weapon-benefit cascades. First occurrence picks a specific blade/gun, adds
   * it as a possession benefit, and records skill-0. Subsequent occurrences
   * bump skill in the same weapon.
   */
  doBladeBenefit() {
    if (this.bladeBenefit !== "") {
      // PM p. 20 repeated benefit: same / different / +1 category skill.
      this.doRepeatWeaponBenefit("blade");
      return;
    }
    const pool = cascadePoolByKey("bladeCombat", this.editionId);
    const known = this.knownFromPool(pool);
    this.pickOrDefer({
      kind: "cascade",
      label: "Choose a blade for your weapon benefit",
      options: pool,
      preferred: known,
      context: { source: "muster", benefit: "Blade" },
      onResolve: (ch, blade) => {
        ch.bladeBenefit = blade;
        ch.addBenefit(blade);
        ch.log(ev.cascadePick("Blade Combat", blade));
        ch.addSkill(blade, 0, "Blade benefit");
      },
    });
  }

  doGunBenefit() {
    if (this.gunBenefit !== "") {
      this.doRepeatWeaponBenefit("gun");
      return;
    }
    const pool = cascadePoolByKey("gunCombat", this.editionId);
    const known = this.knownFromPool(pool);
    this.pickOrDefer({
      kind: "cascade",
      label: "Choose a gun for your weapon benefit",
      options: pool,
      preferred: known,
      context: { source: "muster", benefit: "Gun" },
      onResolve: (ch, gun) => {
        ch.gunBenefit = gun;
        ch.addBenefit(gun);
        ch.log(ev.cascadePick("Gun Combat", gun));
        ch.addSkill(gun, 0, "Gun benefit");
      },
    });
  }

  /** PM p. 20: on a repeated weapon benefit the character may
   *    (1) bump the existing weapon's skill,
   *    (2) pick a different weapon from the cascade pool, or
   *    (3) take +1 in the weapon category (Blade Combat / Gun Combat).
   *  Interactive mode queues a choice; auto mode keeps the historical
   *  "bump existing" default (option 1) since the player isn't watching. */
  private doRepeatWeaponBenefit(kind: "blade" | "gun"): void {
    const cascadeKey = kind === "blade" ? "bladeCombat" : "gunCombat";
    const categorySkill = kind === "blade" ? "Blade Combat" : "Gun Combat";
    const current = kind === "blade" ? this.bladeBenefit : this.gunBenefit;
    if (this.choiceMode === "auto") {
      this.addSkill(current, 1, `Repeat ${kind} benefit (bump)`);
      return;
    }
    const pool = cascadePoolByKey(cascadeKey, this.editionId);
    const optBump = `Bump ${current}`;
    const optDifferent = `Pick a different ${kind}`;
    const optCategory = `+1 in ${categorySkill}`;
    this.pickOrDefer({
      kind: "repeatWeaponBenefit",
      label: `${current} (already received) — repeated weapon benefit choice (PM p. 20)`,
      options: [optBump, optDifferent, optCategory],
      context: { source: "muster", benefit: "RepeatWeapon", current, category: categorySkill },
      onResolve: (ch, chosen) => {
        if (chosen === optBump) {
          ch.addSkill(current, 1, `Repeat ${kind} benefit (bump)`);
          return;
        }
        if (chosen === optCategory) {
          ch.addSkill(categorySkill, 1, `Repeat ${kind} benefit (+1 category)`);
          return;
        }
        // "Pick a different weapon" — queue an inner cascade choice.
        const known = ch.knownFromPool(pool);
        ch.pickOrDefer({
          kind: "cascade",
          label: `Choose a different ${kind}`,
          options: pool,
          preferred: known,
          context: { source: "muster", benefit: kind === "blade" ? "Blade" : "Gun" },
          onResolve: (c, weapon) => {
            c.addBenefit(weapon);
            c.log(ev.cascadePick(categorySkill, weapon));
            c.addSkill(weapon, 0, `Repeat ${kind} benefit (different)`);
          },
        });
      },
    });
  }

  /**
   * CotI generic "Weapon" benefit: character may pick any personal weapon
   * (blade or gun). Two-stage choice: first weapon type, then specific.
   */
  doWeaponBenefit() {
    this.pickOrDefer({
      kind: "weaponType",
      label: "Choose weapon type",
      options: ["Blade", "Gun"],
      context: { source: "muster", benefit: "Weapon" },
      onResolve: (ch, type) => {
        if (type === "Blade") ch.doBladeBenefit();
        else ch.doGunBenefit();
      },
    });
  }

  /** Names from `pool` that the character already has skills in (for cascade
   *  preference: subsequent blade cascades stack onto an existing blade). */
  private knownFromPool(pool: readonly string[]): string[] {
    const out: string[] = [];
    for (const [n] of this.skills) {
      if (pool.includes(n)) out.push(n);
    }
    return out;
  }

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

  // ---------- anagathics ----------

  /** Try to obtain anagathics for the upcoming term (PM p. 15). Returns
   *  whether a supply was secured. Requires age ≥ 30 at end of third
   *  term. Caller is expected to call this before survival each term
   *  they want to use anagathics. If the availability roll fails and
   *  `allowRetry` is true (default), the character makes an extra
   *  survival roll: on success a single retry is granted (PM "one retry
   *  is allowed if the character rerolls another survival roll first");
   *  on failure the character is short-term mustered out ("forced to
   *  muster out"). */
  tryAnagathics(allowRetry = true): boolean {
    const rules = this.anagathicsRules();
    const minAge = rules?.eligibility?.minAge ?? 30;
    const minTerms = rules?.eligibility?.minTerms ?? 3;
    if (this.age < minAge || this.terms < minTerms) {
      this.log(ev.anagathics("unavailable"));
      return false;
    }
    const result = this.rollAnagathicsAvailability();
    if (result) return true;
    if (!allowRetry) return false;
    // PM retry mechanic: extra survival roll gates one retry.
    if (!this.rollAnagathicsRetrySurvival()) return false;
    return this.rollAnagathicsAvailability();
  }

  /** Anagathics rules block from the active edition. Returns null if the
   *  edition doesn't declare one (CT — no anagathics in TTB). */
  private anagathicsRules(): {
    eligibility?: { minAge?: number; minTerms?: number };
    availability?: {
      target?: number;
      dms?: {
        byStarport?: Record<string, number>;
        byTech?: Record<string, number>;
      };
    };
  } | null {
    const rules = getEdition(this.editionId).rules.anagathics;
    return (rules as ReturnType<Character["anagathicsRules"]>) ?? null;
  }

  /** Roll 2D + DMs for anagathics availability and apply the success/failure
   *  side-effects. Returns whether a supply was found. */
  private rollAnagathicsAvailability(): boolean {
    const rules = this.anagathicsRules();
    const target = rules?.availability?.target ?? 12;
    const starportDms = rules?.availability?.dms?.byStarport ?? {};
    const techDms = rules?.availability?.dms?.byTech ?? {};
    let dm = 0;
    const sp = this.homeworld?.starport;
    if (sp && starportDms[sp] !== undefined) dm += starportDms[sp]!;
    const t = this.homeworld?.tech;
    if (t && techDms[t] !== undefined) dm += techDms[t]!;
    const r = roll(2) + dm;
    const success = r >= target;
    if (success) {
      if (!this.onAnagathics) {
        this.apparentAge = this.age;
      }
      this.onAnagathics = true;
      this.anagathicsActiveThisTerm = true;
      this.anagathicsEverTaken = true;
      this.anagathicsBenefitForfeitedTerms += 1;
      // Clear any withdrawal flag set by a prior failed attempt this term
      // — the retry path can flip from "lost supply" to "found supply" and
      // the character should not get withdrawal effects in the latter case.
      this.anagathicsWithdrawalThisTerm = false;
      this.log(ev.anagathics("found", r, target));
    } else if (this.onAnagathics) {
      this.log(ev.anagathics("lost", r, target));
      this.anagathicsWithdrawalThisTerm = true;
      this.onAnagathics = false;
    } else {
      // Not currently on anagathics and the roll missed — record the
      // failed availability roll at verbose for full visibility.
      this.log(ev.anagathics("unavailable", r, target));
    }
    return success;
  }

  /** Extra survival roll gating the anagathics retry (PM p. 15). On
   *  failure the character is forced into a short-term muster-out. */
  private rollAnagathicsRetrySurvival(): boolean {
    try {
      const svc = this.serviceDef();
      // checkSurvival emits ev.roll("Survival", ...) which already records
      // pass/fail in the history.
      const passed = svc.checkSurvival(this);
      if (!passed) {
        // Increment shortTermsCount (muster-out accounting doesn't count
        // this term) and transition to retired. The intermediate
        // shortTerm status is skipped since chargen ends immediately.
        this.shortTermsCount += 1;
        this.endChargenRetired("failed anagathics retry survival");
      }
      return passed;
    } catch {
      // Pre-enlistment (no service yet) — retry not available.
      return false;
    }
  }

  /** Pre-survival anagathics hook (PM p. 15). Reads anagathicsStandingOrder
   *  and, if set + eligible, sets wantsAnagathicsThisTerm and attempts to
   *  locate a supply via tryAnagathics. Called at the start of every term
   *  before survival is rolled. Idempotent if eligibility fails or the
   *  standing order is off. */
  preSurvivalAnagathicsHook(): void {
    if (!this.anagathicsStandingOrder) return;
    // Eligibility: age ≥ 30 at end of third term. tryAnagathics enforces
    // this and is a no-op when the threshold isn't met; calling here is
    // still safe but we gate to avoid the extra history line for the
    // common pre-eligibility case.
    const rules = this.anagathicsRules();
    const minAge = rules?.eligibility?.minAge ?? 30;
    const minTerms = rules?.eligibility?.minTerms ?? 3;
    if (this.age < minAge || this.terms < minTerms) return;
    this.wantsAnagathicsThisTerm = true;
    this.tryAnagathics();
  }

  /** Voluntarily stop taking anagathics. The character reverts to normal
   *  survival rolls; withdrawal applies at term end. */
  discontinueAnagathics(): void {
    if (!this.onAnagathics) return;
    this.onAnagathics = false;
    this.anagathicsActiveThisTerm = false;
    this.anagathicsWithdrawalThisTerm = true;
    this.log(ev.anagathics("withdrawal"));
  }

  // ---------- aging ----------

  ageAttribute(attrib: AttributeKey, req: number, reduction: number) {
    const r = roll(2);
    const passed = r >= req;
    this.log(ev.roll(`Aging ${attrShort(attrib)}`, r, 0, req, passed));
    if (!passed) this.improveAttribute(attrib, reduction);
  }

  doAging() {
    // Reads the active edition's aging.rows table. Each row applies if
    // this.terms >= row.endOfTerm AND the row is the highest qualifying.
    // CT and MT share the same aging breakpoints (term 4-7, 8-11, 12+).
    interface AgingRow {
      age: number | string;
      endOfTerm: number;
      effects: Partial<
        Record<AttributeKey, { delta: number; save: number }>
      >;
    }
    interface AgingCrisis {
      whenAttributeReducedTo?: number;
      save?: number;
    }
    const aging = getEdition(this.editionId).data.aging as {
      rows?: AgingRow[];
      agingCrisis?: AgingCrisis;
    } | undefined;
    if (!aging?.rows) return;

    // Apparent age tracks the Aging-table line. On anagathics it stays
    // frozen at the line the character was on when they started taking
    // them. Otherwise it follows chronological terms served (effective
    // terms used to pick the row).
    if (this.apparentAge === 0) this.apparentAge = this.age;
    // Short terms only count for half-aging. PM p. 16: a short term is 2
    // years and the term should not trigger full-term aging breakpoints.
    // Compute aging from completed full terms only (terms minus short).
    const effectiveTermsForAging = this.onAnagathics
      ? Math.floor((this.apparentAge - 18) / 4)
      : Math.max(0, this.terms - this.shortTermsCount);

    // Pick the highest row whose endOfTerm <= effectiveTermsForAging.
    const applicable = aging.rows
      .filter((r) => effectiveTermsForAging >= r.endOfTerm)
      .sort((a, b) => b.endOfTerm - a.endOfTerm)[0];
    if (!applicable) return;

    // Anagathics withdrawal: double saving throws on each characteristic;
    // both must pass to avoid the listed reduction (PM p. 15).
    const withdrawal = this.anagathicsWithdrawalThisTerm;
    // Anagathics benefit (PM p. 15): on a maintained supply the character
    // automatically succeeds at the aging saving throws for two
    // characteristics of his or her choice (per term). Default policy in
    // auto mode is the two with the highest save targets (most likely to
    // fail), so the benefit lands where it helps most.
    const effects = Object.entries(applicable.effects) as
      [AttributeKey, { delta: number; save: number }][];
    const autoSaves = new Set<AttributeKey>();
    if (this.onAnagathics && !withdrawal && effects.length > 0) {
      const ranked = [...effects].sort((a, b) => b[1].save - a[1].save);
      const n = Math.min(2, ranked.length);
      for (let i = 0; i < n; i++) autoSaves.add(ranked[i]![0]);
      for (const attr of autoSaves) this.log(ev.agingSave(attr, "auto"));
    }
    for (const [attr, eff] of effects) {
      if (autoSaves.has(attr)) continue;
      if (withdrawal) {
        const r1 = roll(2);
        const r2 = roll(2);
        const failed = r1 < eff.save || r2 < eff.save;
        this.log(ev.agingSave(
          attr, failed ? "failed" : "passed",
          { dice: [r1, r2], save: eff.save },
        ));
        if (failed) this.improveAttribute(attr, eff.delta);
      } else {
        this.ageAttribute(attr, eff.save, eff.delta);
      }
    }
    // Clear withdrawal flag after the term-end aging applies it once.
    this.anagathicsWithdrawalThisTerm = false;
    // If anagathics supply is maintained, apparent age does NOT advance.
    // Otherwise update apparent age to chronological.
    if (!this.onAnagathics) {
      this.apparentAge = this.age;
    }

    const crisisThreshold = aging.agingCrisis?.whenAttributeReducedTo ?? 0;
    const crisisSave = aging.agingCrisis?.save ?? 8;
    for (const a of Object.keys(this.attributes) as AttributeKey[]) {
      if (this.deceased) break;
      if (this.attributes[a] <= crisisThreshold) {
        const cr = roll(2);
        this.log(ev.roll(`Aging crisis (${attrShort(a)})`, cr, 0, crisisSave, cr >= crisisSave));
        if (cr < crisisSave) {
          this.endChargenDeceased("aging crisis");
        } else {
          this.attributes[a] = 1;
        }
      }
    }
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
  next.events = [...c.events];
  next.musterLog = [...c.musterLog];
  // pendingChoices must be cloned: workflow handlers in app/page.tsx mutate
  // the clone (via pickOrDefer → pendingChoices.push) before committing.
  // A shared reference leaks queued cascades back to the unrelated original
  // when the handler bails on ChoicePendingError, stacking stale choices
  // across stages.
  next.pendingChoices = [...c.pendingChoices];
  return next;
}
