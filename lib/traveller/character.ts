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
import {
  applyReducedPassageBenefit,
  merchantEnlist,
  merchantFinalizeMuster,
} from "./engine/acg/pathways/merchantPrince";
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

/** Look up the display name for the skill-table index from the edition's
 *  `skillTableMeta` block. Falls back to the table key if no display name
 *  is declared. */
function skillTableDisplayName(editionId: string, index: number): string {
  const meta = (getEdition(editionId).data as {
    skillTableMeta?: { order?: string[]; displayNames?: Record<string, string> };
  }).skillTableMeta;
  const key = meta?.order?.[index - 1];
  if (!key) return `table ${index}`;
  return meta?.displayNames?.[key] ?? key;
}

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
      /** Subsector tech code (PM p. 52: Navy characters must know this).
       *  Defaults to homeworld tech, clamped to Early Stellar minimum per
       *  PM rule ("always no less than Early Stellar"). */
      subsectorTechCode?: string;
    } = {},
  ): void {
    this.useAcg = true;
    const prev = this.acgState;
    const hasCommission = prev?.preCareerCommission === true;

    // Rrev2: pre-career failure may force the character into a specific
    // service (PM p. 47). Override the user's pathway/options when a
    // draft is pending.
    let effPathway = pathway;
    const draft = prev?.preCareerDraftedInto;
    if (draft === "navy") {
      effPathway = "navy";
      options = { ...options, fleet: options.fleet ?? "imperialNavy" };
    } else if (draft === "army") {
      effPathway = "mercenary";
      options = { ...options, service: "army" };
    } else if (draft === "marines") {
      effPathway = "mercenary";
      options = { ...options, service: "marines" };
    }
    this.acgPathway = effPathway;

    // Rrev6: set this.service BEFORE the pathway-specific enlistment runs.
    // Pathway enlist functions can queue interactive choices, throwing
    // ChoicePendingError; if service is set after, the character is left
    // with service="other" while acgState says e.g. "navy". Order matters.
    if (effPathway === "mercenary") {
      this.service = (options.service === "marines" ? "marines" : "army") as ServiceKey;
    } else if (effPathway === "navy") {
      this.service = "navy" as ServiceKey;
    } else if (effPathway === "scout") {
      this.service = "scouts" as ServiceKey;
    } else if (effPathway === "merchantPrince") {
      this.service = "merchants" as ServiceKey;
    }

    this.acgState = {
      pathway: effPathway,
      rankCode: hasCommission ? prev!.rankCode : "E1",
      isOfficer: hasCommission ? prev!.isOfficer : false,
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
      schoolsAttended: prev?.schoolsAttended ? [...prev.schoolsAttended] : [],
      decorations: prev?.decorations ? [...prev.decorations] : [],
      browniePoints: prev?.browniePoints ?? 0,
      browniePointsSpent: prev?.browniePointsSpent ?? 0,
      decorationDmStrategy: 0,
      ...(prev?.honorsGraduations ? { honorsGraduations: [...prev.honorsGraduations] } : {}),
      ...(hasCommission ? { preCareerCommission: true } : {}),
      ...(prev?.preCareerBranch !== undefined ? { preCareerBranch: prev.preCareerBranch } : {}),
      ...(prev?.preCareerFirstTermShort ? { preCareerFirstTermShort: true } : {}),
      ...(prev?.preCareerDraftedInto ? { preCareerDraftedInto: prev.preCareerDraftedInto } : {}),
      ...(prev?.attemptMerchantAcademy !== undefined
        ? { attemptMerchantAcademy: prev.attemptMerchantAcademy } : {}),
    };
    if (hasCommission) this.commissioned = true;
    if (draft) {
      this.drafted = true;
      this.history.push(`Drafted into ${this.service} (pre-career failure).`);
    }
    // Navy: record subsector tech code (PM p. 52). Default: homeworld tech,
    // clamped to Early Stellar minimum.
    if (pathway === "navy") {
      const homeworldTech = this.homeworld?.tech;
      const order = (getEdition(this.editionId).data as {
        homeworld?: { techCodeOrder?: string[] };
      }).homeworld?.techCodeOrder ?? [];
      let subsectorTech = options.subsectorTechCode ?? homeworldTech;
      const earlyIdx = order.indexOf("Early Stellar");
      if (subsectorTech && order.length > 0 && earlyIdx >= 0) {
        const idx = order.indexOf(subsectorTech);
        if (idx < earlyIdx) subsectorTech = "Early Stellar";
      }
      if (subsectorTech) this.acgState.subsectorTechCode = subsectorTech;
    }
    // Interactive-mode enlistment may queue a player choice (Navy Soc 9+
    // branch pick, scout admin DM, etc.); swallow ChoicePendingError so
    // the character's pendingChoices stand. The UI resolves them and the
    // pause-and-resume machinery in runAcgYear handles subsequent flow.
    // service was already set above — pathway functions only manipulate
    // acgState.
    try {
      switch (effPathway) {
        case "mercenary":
          mercenaryEnlist(this, options.service ?? "army", options.combatArm ?? "Infantry");
          break;
        case "navy":
          navyEnlist(this, options.fleet ?? "imperialNavy");
          break;
        case "scout":
          this.acgState.division = options.division ?? "field";
          scoutEnlist(this);
          break;
        case "merchantPrince":
          merchantEnlist(this, options.lineType ?? "Free Trader");
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
    this.debugHistory(`Skill from table ${table} ${skillTableDisplayName(this.editionId, table)}`);
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
    const hasCap = !!(ed.data as { rules?: { skillCap?: unknown } }).rules?.skillCap;
    if (!hasCap) return;
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
          this.verboseHistory(`Reduced ${last[0]} to level ${last[1]} (Int+Edu cap)`);
        } else {
          this.skills.pop();
          this.verboseHistory(`Forfeited ${last[0]} (Int+Edu cap)`);
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
          c.verboseHistory(`Reduced ${name} to level ${entry[1]} (Int+Edu cap)`);
        } else {
          c.skills.splice(i, 1);
          c.verboseHistory(`Forfeited ${name} (Int+Edu cap)`);
        }
        c.enforceSkillCap();
      },
    });
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
        ch.addSkill(blade, 0);
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
        ch.addSkill(gun, 0);
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
      this.addSkill(current);
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
          ch.addSkill(current);
          return;
        }
        if (chosen === optCategory) {
          ch.addSkill(categorySkill, 1);
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
            c.addSkill(weapon, 0);
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
      this.applyServiceStartAge("nobles");
      this.service = "nobles";
      // R15: apply service-conditioned homeworld default skills (Vacc Suit-0,
      // Gun Combat-0, tech-keyed vehicles/computer) — previously skipped on
      // the auto-noble path.
      if (this.homeworld) applyHomeworldSkills(this, this.homeworld);
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
    // Reset per-term anagathics flags; intent for this term is set below
    // from anagathicsStandingOrder (or by an explicit pre-survival call).
    this.anagathicsActiveThisTerm = false;
    this.anagathicsWithdrawalThisTerm = false;
    this.wantsAnagathicsThisTerm = false;
    this.preSurvivalAnagathicsHook();
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
    // F2/F3: PM p. 16 disability conditions force muster regardless of
    // the reenlistment roll. Block reenlist for both basic and ACG flows.
    const dis = this.isDisabled();
    if (dis.disabled) {
      this.activeDuty = false;
      if (this.isRetirementEligible()) this.retired = true;
      this.history.push(
        `Forced muster-out (disability: ${dis.reasons.join("; ")}).`,
      );
      return;
    }
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
    } else if (
      // CT mandates retirement at end of term 7. MT does not (voluntary
      // any-term per PM p. 17). Read the cap from edition rules.
      (() => {
        const rules = getEdition(this.editionId).data.rules as {
          reenlistment?: { mandatoryRetireAfterTerm?: number };
        } | undefined;
        const cap = rules?.reenlistment?.mandatoryRetireAfterTerm ?? 7;
        return this.terms >= cap;
      })() && !(
        getEdition(this.editionId).data.rules as {
          reenlistment?: { voluntaryAnyTerms?: boolean };
        } | undefined)?.reenlistment?.voluntaryAnyTerms
    ) {
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
      // PM p. 17: a character denied reenlistment after 5+ terms still
      // retires (and gets the cash-table +1 retirement DM), unless their
      // service is on the no-retirement excludedServices list (Barbarians,
      // Pirates, Rogues, Scouts per MT).
      if (this.isRetirementEligible()) this.retired = true;
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

  /** True when this character qualifies for retirement: at least the
   *  edition's eligibleAfterCompletedTerm and not in the excludedServices
   *  list (MT excludes Barbarians, Pirates, Rogues, Scouts per PM p. 17). */
  isRetirementEligible(): boolean {
    const rules = getEdition(this.editionId).data.rules as {
      retirement?: {
        eligibleAfterCompletedTerm?: number;
        excludedServices?: string[];
      };
    } | undefined;
    const minTerms = rules?.retirement?.eligibleAfterCompletedTerm ?? 5;
    const excluded = rules?.retirement?.excludedServices ?? ["scouts", "other"];
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
    const rules = getEdition(this.editionId).data.rules as {
      disability?: {
        physicalAttributes?: string[];
        atAgeLine?: number;
        physicalAttributeAtMost?: number;
        sumPhysicalAttributesAtMost?: number;
      };
    } | undefined;
    const d = rules?.disability;
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
    if (this.age < 30 || this.terms < 3) {
      this.verboseHistory("Anagathics unavailable: must be at least age 30 and end of third term.");
      return false;
    }
    const result = this.rollAnagathicsAvailability();
    if (result) return true;
    if (!allowRetry) return false;
    // PM retry mechanic: extra survival roll gates one retry.
    if (!this.rollAnagathicsRetrySurvival()) return false;
    return this.rollAnagathicsAvailability();
  }

  /** Roll 2D + DMs for anagathics availability and apply the success/failure
   *  side-effects. Returns whether a supply was found. */
  private rollAnagathicsAvailability(): boolean {
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

  /** Extra survival roll gating the anagathics retry (PM p. 15). On
   *  failure the character is forced into a short-term muster-out. */
  private rollAnagathicsRetrySurvival(): boolean {
    try {
      const svc = this.serviceDef();
      const passed = svc.checkSurvival(this);
      this.history.push(
        `Anagathics retry survival ${passed ? "passed" : "failed"}.`,
      );
      if (!passed) {
        this.shortTermThisTerm = true;
        this.shortTermsCount += 1;
        this.activeDuty = false;
        this.history.push("Forced to muster out after failed retry survival roll.");
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
    if (this.age < 30 || this.terms < 3) return;
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
      this.verboseHistory(
        `Anagathics auto-saves: ${[...autoSaves].join(", ")} (2 of ${effects.length})`,
      );
    }
    for (const [attr, eff] of effects) {
      if (autoSaves.has(attr)) continue;
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
          rankExtraRolls?: { rankMin: number; rankMax: number; additionalRolls: number }[];
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
    // PM p. 17: rank extra rolls are cumulative — rank 5-6 gets +3,
    // rank 3-4 gets +2, rank 1-2 gets +1. Prefer rankExtraRolls (the
    // canonical form) when present; otherwise fall through to the legacy
    // rankBands flat-additional form.
    if (rules?.rankExtraRolls?.length) {
      const band = rules.rankExtraRolls.find(
        (b) => this.rank >= b.rankMin && this.rank <= b.rankMax,
      );
      if (band) r += band.additionalRolls;
    } else {
      const band = rules?.rankBands?.find((b) => b.ranks.includes(this.rank));
      if (band) r += band.additionalRolls;
    }
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
    const retirement = (
      getEdition(this.editionId).data.rules as {
        retirement?: {
          eligibleAfterCompletedTerm?: number;
          basePensionCredits?: number;
          pensionCreditsPerTerm?: number;
          excludedServices?: string[];
          anagathicTermsExcluded?: boolean;
        };
      }
    ).retirement;
    const eligibleAfter = retirement?.eligibleAfterCompletedTerm ?? 5;
    const basePension = retirement?.basePensionCredits ?? 4000;
    const perTerm = retirement?.pensionCreditsPerTerm ?? 2000;
    const excluded = new Set(
      retirement?.excludedServices ?? ["scouts", "other"],
    );
    const anagathicsExcluded = retirement?.anagathicTermsExcluded ?? false;
    const qualifyingTerms = anagathicsExcluded
      ? this.terms - (this.anagathicsBenefitForfeitedTerms ?? 0)
      : this.terms;
    if (!pensionForfeit && qualifyingTerms >= eligibleAfter &&
        !excluded.has(this.service as string)) {
      this.retirementPay = basePension + (qualifyingTerms - eligibleAfter) * perTerm;
      this.benefits.push(
        `${numCommaSep(this.retirementPay)}/yr Retirement Pay`,
      );
    } else if (pensionForfeit && this.terms >= eligibleAfter) {
      this.history.push("Pension forfeit due to dishonorable discharge or death sentence.");
    }
    // ACG Merchant Free Trader Owner/Captain auto-benefit.
    if (this.useAcg && this.acgState?.pathway === "merchantPrince") {
      merchantFinalizeMuster(this);
      // F13: Reduced Passage benefit per PM p. 61 line 3851 — ex-merchants
      // may purchase stand-by middle passages at half price.
      applyReducedPassageBenefit(this);
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
