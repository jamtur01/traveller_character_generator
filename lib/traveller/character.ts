// The Character class: rolls, terms, skills, muster-out. Service-specific
// tables live in `./services/*` and are looked up via the `s` registry inside
// method bodies (avoids module-load cycles).

import { arnd, rndInt, roll } from "./random";
import type { ChoiceMode, ChoiceRequest, PendingChoice } from "./engine/choices";
import { genChoiceId, ChoicePendingError } from "./engine/choices";
import { cascadePoolByKey } from "./engine/cascadeMap";
import type { AcgState } from "./engine/acg/types";
import {
  applyHomeworldSkills, availableServicesForHomeworld, editionHasHomeworld,
  generateAndApplyHomeworld, type Homeworld,
} from "./engine/homeworld";
import { mercenaryEnlist } from "./engine/acg/pathways/mercenary";
import {
  applyPreCareerResult, attemptPreCareer, type PreCareerOption,
} from "./engine/acg/preCareer";
import { navyEnlist } from "./engine/acg/pathways/navy";
import { scoutEnlist } from "./engine/acg/pathways/scout";
import { merchantEnlist, merchantFinalizeMuster } from "./engine/acg/pathways/merchantPrince";
import { scoutFinalizeMuster } from "./engine/acg/pathways/scout";
import { runAcgTerm, runAcgReenlist } from "./engine/acg/runner";
import { generateGender, generateName } from "./names";
import { attrShort, extendedHex, intToOrdinal, numCommaSep } from "./formatting";
import type {
  AttributeKey,
  Attributes,
  Gender,
  ServiceDef,
  ServiceKey,
  ShowHistory,
  Skill,
} from "./types";
import {
  getDraftServices, getEditionServices, getEnlistableServices,
} from "./services";
import { DEFAULT_EDITION_ID, getEdition } from "./editions";
import { runTermSteps } from "./engine/runner";
import { formatCharacterSheet } from "./sheet";

const SKILL_TABLE_NAMES = [
  "personal development", "service skills",
  "advanced education", "advanced education 8+",
] as const;

export class Character {
  age = 18;
  gender: Gender = generateGender();
  name: string = generateName(this.gender);
  showHistory: ShowHistory = "simple";
  terms = 0;
  credits = 0;
  history: string[] = [];
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
  deceased = false;
  commissioned = false;
  rank = 0;
  activeDuty = true;
  musteredOut = false;
  retired = false;
  retirementPay = 0;
  forceTable = false;
  forceTableIndex = 1;
  musterCashUsed = 0;
  musterRolls = 0;
  /** Human-readable log of each muster-out roll's outcome. */
  musterLog: string[] = [];
  /**
   * True when the most recent reenlistment roll was 12. Per TTB p. 18 the
   * character must serve another term regardless of personal preference, so
   * the UI suppresses voluntary muster-out until the forced term completes.
   */
  mandatoryReenlistment = false;
  /**
   * True for the current term when MT's short-term rule fired: the character
   * failed survival, served only 2 years of the 4-year term, and the term is
   * not counted for mustering-out benefits. Commission/promotion are skipped
   * for the term; special duty/skills can still happen. Per MT PM p. 16.
   * Reset at the start of each term in doServiceTermStep.
   */
  shortTermThisTerm = false;
  /**
   * Count of short terms served. Each one was 2 years (not 4) and does not
   * count toward mustering-out benefit rolls.
   */
  shortTermsCount = 0;
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
    honors: boolean;
    graduated: boolean;
    commissioned: boolean;
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
      honors: result.honors,
      graduated: result.graduated,
      commissioned: result.commissioned,
    };
  }

  /**
   * Begin Advanced Character Generation. Initializes acgState for the
   * chosen pathway and runs pathway-specific enlistment with the
   * pathway-appropriate options. After this call, subsequent
   * doServiceTermStep() invocations run the ACG per-year cycle.
   */
  beginAcg(
    pathway: "mercenary" | "navy" | "scout" | "merchantPrince",
    options: {
      combatArm?: string;
      service?: "army" | "marines";
      fleet?: "imperialNavy" | "reserveFleet" | "systemSquadron";
      division?: "field" | "bureaucracy";
      lineType?: string;
    } = {},
  ): void {
    this.useAcg = true;
    this.acgPathway = pathway;
    // Pre-career may have set acgState already with a commission (academy
    // graduate, OTC/NOTC). Preserve commission state instead of resetting.
    const carryRank = this.acgState?.preCareerCommission
      ? { rankCode: this.acgState.rankCode, isOfficer: this.acgState.isOfficer,
          preCareerCommission: true,
          preCareerBranch: this.acgState.preCareerBranch ?? null,
          browniePoints: this.acgState.browniePoints,
          browniePointsSpent: this.acgState.browniePointsSpent,
          schoolsAttended: this.acgState.schoolsAttended,
          decorations: this.acgState.decorations }
      : null;
    this.acgState = {
      pathway,
      rankCode: carryRank?.rankCode ?? "E1",
      isOfficer: carryRank?.isOfficer ?? false,
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
      schoolsAttended: carryRank?.schoolsAttended ?? [],
      decorations: carryRank?.decorations ?? [],
      browniePoints: carryRank?.browniePoints ?? 0,
      browniePointsSpent: carryRank?.browniePointsSpent ?? 0,
      decorationDmStrategy: 0,
      ...(carryRank?.preCareerCommission ? { preCareerCommission: true } : {}),
      ...(carryRank?.preCareerBranch !== undefined ? { preCareerBranch: carryRank.preCareerBranch } : {}),
    };
    if (carryRank) this.commissioned = true;
    // Interactive-mode enlistment may queue a player choice (Navy Soc 9+
    // branch pick, scout admin DM, etc.); swallow ChoicePendingError so
    // the character's pendingChoices stand. The UI resolves them and the
    // pause-and-resume machinery in runAcgYear handles subsequent flow.
    try {
    switch (pathway) {
      case "mercenary":
        mercenaryEnlist(this, options.service ?? "army", options.combatArm ?? "Infantry");
        this.service = (options.service === "marines" ? "marines" : "army") as ServiceKey;
        break;
      case "navy":
        navyEnlist(this, options.fleet ?? "imperialNavy");
        this.service = "navy" as ServiceKey;
        break;
      case "scout":
        this.acgState.division = options.division ?? "field";
        scoutEnlist(this);
        this.service = "scouts" as ServiceKey;
        break;
      case "merchantPrince":
        merchantEnlist(this, options.lineType ?? "Free Trader");
        this.service = "merchants" as ServiceKey;
        break;
    }
    } catch (err) {
      if (!(err instanceof ChoicePendingError)) throw err;
      // Pending choice queued — UI will resolve it.
    }
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
    this.debugHistory(`Skill from table ${table} ${SKILL_TABLE_NAMES[table - 1]}`);
    return table;
  }

  addSkill(skill: string, skillLevel = 1) {
    const i = this.checkSkill(skill);
    if (i >= 0) {
      const entry = this.skills[i]!;
      entry[1] += skillLevel;
      this.verboseHistory(`Improved ${skill}-${entry[1]}`);
    } else {
      this.skills.push([skill, skillLevel]);
      this.verboseHistory(`Learned ${skill}-${skillLevel}`);
    }
  }

  improveAttribute(attrib: AttributeKey, delta = 1) {
    this.attributes[attrib] += delta;
    // TTB p. 17: characteristic values may not exceed 15 for player characters.
    if (this.attributes[attrib] > 15) {
      this.verboseHistory(
        `${attrib} would exceed 15; capping at 15 (TTB p. 17).`,
      );
      this.attributes[attrib] = 15;
    }
    if (this.attributes[attrib] < 1 && attrib === "social") {
      this.verboseHistory(`Decreased ${attrib} below 1, keeping it at 1`);
      this.attributes[attrib] = 1;
    } else {
      if (this.attributes[attrib] < 0) this.attributes[attrib] = 0;
      this.verboseHistory(
        `${delta > 0 ? "Increased " : "Decreased "}${attrib} by ${delta} to ${extendedHex(this.attributes[attrib])}`,
      );
    }
  }

  addBenefit(benefit: string) {
    this.benefits.push(benefit);
    this.verboseHistory(benefit);
  }

  verboseHistory(text: string) {
    if (this.showHistory === "verbose" || this.showHistory === "debug") {
      this.history.push(text);
    }
  }

  debugHistory(text: string) {
    if (this.showHistory === "debug") this.history.push(text);
  }

  /**
   * Weapon-benefit cascades. First occurrence picks a specific blade/gun, adds
   * it as a possession benefit, and records skill-0. Subsequent occurrences
   * bump skill in the same weapon.
   */
  doBladeBenefit() {
    if (this.bladeBenefit !== "") {
      this.addSkill(this.bladeBenefit);
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
        ch.addSkill(blade, 0);
      },
    });
  }

  doGunBenefit() {
    if (this.gunBenefit !== "") {
      this.addSkill(this.gunBenefit);
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
        ch.addSkill(gun, 0);
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

  doEnlistment(method: string): ServiceKey {
    const enlistable = getEnlistableServices(this.editionId);
    const draftPool = getDraftServices(this.editionId);
    // ACG enlistment is handled by the ACG runner (Character.doAcgEnlist).
    // Basic-flow doEnlistment is only called for non-ACG characters.
    if (this.useAcg) {
      throw new Error(
        "doEnlistment is for basic chargen only; ACG characters should use the ACG runner",
      );
    }
    // Gate the enlistable list by homeworld tech / social rules (MT
    // only; CT returns the full list unchanged).
    const gated = this.homeworld
      ? availableServicesForHomeworld(this, this.homeworld, enlistable)
      : enlistable;
    let preferredService: ServiceKey;
    if (method && method !== "random") {
      preferredService = method as ServiceKey;
      if (this.homeworld && !gated.includes(preferredService)) {
        this.history.push(
          `Cannot enlist in ${preferredService}: homeworld tech ${this.homeworld.tech} forbids it.`,
        );
        // Force pick from gated list.
        preferredService = gated[Math.floor(Math.random() * gated.length)]!;
      }
    } else {
      preferredService = gated[Math.floor(Math.random() * gated.length)]!;
    }

    // CotI: Soc 10+ characters are automatically enrolled in the Nobility.
    if (this.attributes.social >= 10 && (!method || method === "random")) {
      this.history.push(
        "Distinguished by social standing, automatically enrolled in the Nobility.",
      );
      const skills = this.editionService("nobles").getServiceSkills(this);
      for (const sk of skills) this.addSkill(sk);
      return "nobles";
    }

    const pref = this.editionService(preferredService);
    const dm = pref.enlistmentDM(this.attributes);
    const en = roll(2);
    this.history.push(`Attempted to enlist in ${pref.serviceName}.`);
    this.verboseHistory(
      `Enlistment roll ${en} + ${dm} vs ${pref.enlistmentThrow}`,
    );
    if (en + dm >= pref.enlistmentThrow) {
      this.history.push("Enlistment accepted.");
      this.applyServiceStartAge(preferredService);
      // Now that service is set, apply service-conditioned homeworld
      // default skills (Vacc Suit-0 for Navy/Marines/etc; Gun Combat-0
      // for non-barbarians). MT only — CT has no homeworld.
      this.service = preferredService;
      if (this.homeworld) applyHomeworldSkills(this, this.homeworld);
      const skills = pref.getServiceSkills(this);
      for (const sk of skills) this.addSkill(sk);
      return preferredService;
    }
    this.drafted = true;
    this.history.push("Enlistment denied.");
    const draftService =
      draftPool[Math.floor(Math.random() * draftPool.length)]!;
    this.history.push(`Drafted into ${draftService}.`);
    this.applyServiceStartAge(draftService);
    this.service = draftService;
    if (this.homeworld) applyHomeworldSkills(this, this.homeworld);
    const skills = this.editionService(draftService).getServiceSkills(this);
    for (const sk of skills) this.addSkill(sk);
    return draftService;
  }

  /** Apply the joined service's startAge from edition data. CotI's belter
   *  and barbarian start-at-14 rule comes through this path; MT services
   *  all declare startAge=18. Editions encode this declaratively. */
  private applyServiceStartAge(svc: ServiceKey) {
    const edition = getEdition(this.editionId);
    const data = edition.data.services[svc];
    if (data?.startAge !== undefined) this.age = data.startAge;
  }

  // ---------- service term ----------

  doServiceTermStep() {
    // A mandatory reenlistment is consumed by serving the term it forced.
    this.mandatoryReenlistment = false;
    this.shortTermThisTerm = false;
    this.verboseHistory("--------------------------------------------");
    if (this.useAcg && this.acgState) {
      // ACG runs its own per-year cycle inside runAcgTerm (4 one-year
      // assignments per term). The ACG runner handles term/age increments
      // because mid-term death has different semantics.
      this.verboseHistory(`ACG term ${this.terms + 1} age ${this.age}`);
      runAcgTerm(this);
      return;
    }
    this.terms += 1;
    this.age += 4;
    this.verboseHistory(`Term ${this.terms} age ${this.age}`);
    // Basic chargen: delegate the step sequence to the engine runner.
    runTermSteps(this);
  }

  // ---------- reenlistment ----------

  doReenlistmentStep() {
    if (this.useAcg && this.acgState) {
      const keep = runAcgReenlist(this);
      if (!keep) {
        this.activeDuty = false;
        this.history.push(`Mustered out after ${intToOrdinal(this.terms)} term.`);
      } else if (!this.mandatoryReenlistment) {
        this.history.push(`Eligible to reenlist for ${intToOrdinal(this.terms + 1)} term.`);
      }
      return;
    }
    const def = this.serviceDef();
    const reenlistRoll = roll(2);
    const target = def.reenlistThrow;
    if (def.inverseReenlist) {
      this.verboseHistory(
        `Reenlistment roll ${reenlistRoll} vs ${target}+ to leave (inverse rule)`,
      );
    } else {
      this.verboseHistory(`Reenlistment roll ${reenlistRoll} vs ${target}`);
    }
    if (reenlistRoll === 12) {
      this.mandatoryReenlistment = true;
      this.history.push(
        `Mandatory reenlistment for ${intToOrdinal(this.terms + 1)} term.`,
      );
    } else if (this.terms >= 7) {
      this.activeDuty = false;
      this.retired = true;
      this.history.push(
        `Mandatory retirement after ${intToOrdinal(this.terms)} term.`,
      );
    } else if (def.inverseReenlist) {
      if (reenlistRoll >= target) {
        this.activeDuty = false;
        this.history.push(
          `Released from service after ${intToOrdinal(this.terms)} term.`,
        );
      } else {
        this.history.push(
          `Held over for ${intToOrdinal(this.terms + 1)} term (release roll failed).`,
        );
      }
    } else if (reenlistRoll < target) {
      this.activeDuty = false;
      this.history.push(
        `Denied reenlistment after ${intToOrdinal(this.terms)} term.`,
      );
    } else {
      // The throw only determines eligibility. The player still gets to
      // choose between Run Term and Muster Out at the next term phase, so
      // we record the rule outcome (eligible) rather than the player's
      // pending decision.
      this.history.push(
        `Eligible to reenlist for ${intToOrdinal(this.terms + 1)} term.`,
      );
    }
  }

  // ---------- anagathics ----------

  /** Try to obtain anagathics for the upcoming term (PM p. 15). Returns
   *  whether a supply was secured. Requires age ≥ 30 at end of third
   *  term. Throws if called before the third term's end. Caller is
   *  expected to call this before survival each term they want to use
   *  anagathics. */
  tryAnagathics(): boolean {
    if (this.age < 30 || this.terms < 3) {
      this.verboseHistory("Anagathics unavailable: must be at least age 30 and end of third term.");
      return false;
    }
    let dm = 0;
    const sp = this.homeworld?.starport;
    if (sp === "A") dm += 3;
    else if (sp === "B") dm += 2;
    else if (sp === "C") dm += 1;
    const t = this.homeworld?.tech;
    if (t === "Early Stellar") dm += 1;
    else if (t === "Avg Stellar") dm += 2;
    else if (t === "High Stellar") dm += 3;
    const r = roll(2) + dm;
    this.verboseHistory(`Anagathics availability roll ${r} (DM ${dm}) vs 12+`);
    const success = r >= 12;
    if (success) {
      if (!this.onAnagathics) {
        // First term on anagathics: still advance one line on the Aging
        // Table per manual (so apparent age becomes current chronological).
        this.apparentAge = this.age;
      }
      this.onAnagathics = true;
      this.anagathicsActiveThisTerm = true;
      this.anagathicsEverTaken = true;
      this.anagathicsBenefitForfeitedTerms += 1;
      this.history.push(
        "Found a supply of anagathics for this term (-1 survival, no muster benefit roll).",
      );
    } else if (this.onAnagathics) {
      this.history.push("Lost anagathics supply — withdrawal effects at end of term.");
      this.anagathicsWithdrawalThisTerm = true;
      this.onAnagathics = false;
    }
    return success;
  }

  /** Voluntarily stop taking anagathics. The character reverts to normal
   *  survival rolls; withdrawal applies at term end. */
  discontinueAnagathics(): void {
    if (!this.onAnagathics) return;
    this.onAnagathics = false;
    this.anagathicsActiveThisTerm = false;
    this.anagathicsWithdrawalThisTerm = true;
    this.history.push("Stopped taking anagathics; withdrawal effects pending.");
  }

  // ---------- aging ----------

  ageAttribute(attrib: AttributeKey, req: number, reduction: number) {
    const r = roll(2);
    this.verboseHistory(`Aging ${attrib} throw ${r} vs ${req}`);
    if (r < req) this.improveAttribute(attrib, reduction);
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
    const effectiveTermsForAging = this.onAnagathics
      ? Math.floor((this.apparentAge - 18) / 4)
      : this.terms;

    // Pick the highest row whose endOfTerm <= effectiveTermsForAging.
    const applicable = aging.rows
      .filter((r) => effectiveTermsForAging >= r.endOfTerm)
      .sort((a, b) => b.endOfTerm - a.endOfTerm)[0];
    if (!applicable) return;

    // Anagathics withdrawal: double saving throws on each characteristic;
    // both must pass to avoid the listed reduction (PM p. 15).
    const withdrawal = this.anagathicsWithdrawalThisTerm;
    for (const [attr, eff] of Object.entries(applicable.effects) as
      [AttributeKey, { delta: number; save: number }][]) {
      if (withdrawal) {
        const r1 = roll(2);
        const r2 = roll(2);
        const failed = r1 < eff.save || r2 < eff.save;
        this.verboseHistory(
          `Anagathics withdrawal aging ${attr}: ${r1}/${r2} vs ${eff.save} → ${failed ? "failed" : "passed"}`,
        );
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
      if (this.attributes[a] <= crisisThreshold) {
        const cr = roll(2);
        this.verboseHistory(
          `Aging crisis due to ${a} dropping to ${crisisThreshold} or less, roll ${cr} vs ${crisisSave}`,
        );
        if (cr < crisisSave) {
          this.history.push("Died of illness.");
          this.deceased = true;
          this.activeDuty = false;
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
  finalizeAcgRankForMuster(): void {
    if (!this.useAcg || !this.acgState) return;
    // SEH automatic +1 rank at muster (manual p. 46). Consume the flag so
    // repeated calls don't re-apply.
    if (this.acgState.sehPromotionPending && this.acgState.isOfficer) {
      const m = this.acgState.rankCode.match(/^O(\d+)$/);
      if (m) {
        const next = Math.min(10, parseInt(m[1]!, 10) + 1);
        this.acgState.rankCode = `O${next}`;
        this.history.push(`SEH automatic promotion: rank ${this.acgState.rankCode}.`);
      }
      this.acgState.sehPromotionPending = false;
    }
    if (this.acgState.isOfficer) {
      const m = this.acgState.rankCode.match(/^O(\d+)$/);
      if (m) {
        const n = parseInt(m[1]!, 10);
        this.rank = Math.min(6, n);
        this.commissioned = true;
      }
    }
  }

  musterOutRolls(): number {
    this.finalizeAcgRankForMuster();
    // Reads rules.musterOutRolls from the active edition.
    //   perTerm × qualifyingTerms (default 1) + the additionalRolls of
    //   whichever rankBand contains this character's rank.
    // Short terms (MT survival-failure) don't count toward muster benefits.
    const rules = (
      getEdition(this.editionId).data.rules as {
        musterOutRolls?: {
          perTerm?: number;
          rankBands?: { ranks: number[]; additionalRolls: number }[];
        };
      }
    ).musterOutRolls;
    const perTerm = rules?.perTerm ?? 1;
    const acgPartial = this.acgState?.partialTerms ?? 0;
    const anagathicsTerms = this.anagathicsBenefitForfeitedTerms;
    const qualifyingTerms = Math.max(
      0,
      this.terms - this.shortTermsCount - acgPartial - anagathicsTerms,
    );
    let r = perTerm * qualifyingTerms;
    const band = rules?.rankBands?.find((b) => b.ranks.includes(this.rank));
    if (band) r += band.additionalRolls;
    // ACG court-martial outcomes reduce mustering-out rolls (DD = -3,
    // death sentence zeros benefits via a very negative penalty).
    if (this.useAcg && this.acgState?.musterRollPenalty) {
      r = Math.max(0, r + this.acgState.musterRollPenalty);
    }
    return r;
  }

  musterOutCash(cashDM: number) {
    const idx = Math.min(7, Math.max(1, roll(1) + cashDM));
    const cash = this.serviceDef().musterCash[idx] ?? 0;
    this.credits += cash;
    this.musterLog.push(`Cr${numCommaSep(cash)} cash`);
    this.verboseHistory(`${numCommaSep(cash)} credits`);
  }

  musterOutBenefit(benefitsDM: number) {
    // Snapshot before, then describe what changed after the service's roll
    // table mutates us — works regardless of which mutation it picked.
    const beforeBenefitsLen = this.benefits.length;
    const beforeAttrs = { ...this.attributes };
    const beforeSkillLevels = new Map<string, number>();
    for (const [n, l] of this.skills) beforeSkillLevels.set(n, l);
    const beforeMortgage = this.mortgage;

    this.serviceDef().musterBenefits(this, benefitsDM);

    const newBenefitsList = this.benefits.slice(beforeBenefitsLen);
    const newBenefitsSet = new Set(newBenefitsList);

    const parts: string[] = [...newBenefitsList];
    for (const k of Object.keys(this.attributes) as AttributeKey[]) {
      const delta = this.attributes[k] - beforeAttrs[k];
      if (delta !== 0) {
        const sign = delta > 0 ? "+" : "";
        parts.push(`${sign}${delta} ${attrShort(k)}`);
      }
    }
    for (const [n, l] of this.skills) {
      const prev = beforeSkillLevels.get(n);
      if (prev === undefined) {
        // Bug fix: first weapon-benefit roll adds the weapon at level 0 AND
        // adds the benefit name. Suppress the redundant level-0 skill entry.
        if (l === 0 && newBenefitsSet.has(n)) continue;
        parts.push(l === 0 ? n : `${n}-${l}`);
      } else if (l > prev) {
        parts.push(`${n}-${l}`);
      }
    }
    if (this.mortgage < beforeMortgage) {
      parts.push(`Free Trader mortgage -${beforeMortgage - this.mortgage} yrs`);
    }
    this.musterLog.push(parts.length > 0 ? parts.join(", ") : "No benefit");
  }

  musterOutPay() {
    // Court-martial DD or death-sentence forfeits pension (PM p. 47).
    const pensionForfeit = !!(this.useAcg && this.acgState?.pensionForfeit);
    if (!pensionForfeit && this.terms >= 5 &&
        this.service !== "scouts" && this.service !== "other") {
      switch (this.terms) {
        case 5: this.retirementPay = 4000; break;
        case 6: this.retirementPay = 6000; break;
        case 7: this.retirementPay = 8000; break;
        case 8: this.retirementPay = 10000; break;
        case 9: this.retirementPay = 12000; break;
        default: this.retirementPay = (this.terms - 9) * 2000 + 12000;
      }
      this.benefits.push(
        `${numCommaSep(this.retirementPay)}/yr Retirement Pay`,
      );
    } else if (pensionForfeit && this.terms >= 5) {
      this.history.push("Pension forfeit due to dishonorable discharge or death sentence.");
    }
    // ACG Merchant Free Trader Owner/Captain auto-benefit.
    if (this.useAcg && this.acgState?.pathway === "merchantPrince") {
      merchantFinalizeMuster(this);
    }
    // ACG Scout Detached Duty permanent-assignment benefit.
    if (this.useAcg && this.acgState?.pathway === "scout") {
      scoutFinalizeMuster(this);
    }
  }

  // ---------- titles ----------

  getNobleTitle(): string {
    switch (this.attributes.social) {
      case 11: return this.gender === "female" ? "Dame" : "Sir";
      case 12: return this.gender === "female" ? "Baroness" : "Baron";
      case 13: return this.gender === "female" ? "Marchioness" : "Marquis";
      case 14: return this.gender === "female" ? "Countess" : "Count";
      case 15: return this.gender === "female" ? "Duchess" : "Duke";
      default: return "";
    }
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
  next.history = [...c.history];
  next.musterLog = [...c.musterLog];
  return next;
}
