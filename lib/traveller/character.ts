// The Character class: rolls, terms, skills, muster-out. Service-specific
// tables live in `./services/*` and are looked up via the `s` registry inside
// method bodies (avoids module-load cycles).

import { arnd, rndInt, roll } from "./random";
import type { ChoiceMode, ChoiceRequest, PendingChoice } from "./engine/choices";
import { genChoiceId } from "./engine/choices";
import { cascadePoolByKey } from "./engine/cascadeMap";
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
   * The edition this character was rolled under. Determines which service
   * map, cascade pools, and edition hooks apply. Stays fixed for the
   * character's lifetime — switching editions mid-chargen would invalidate
   * accumulated skills and benefits.
   */
  editionId: string = DEFAULT_EDITION_ID;
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
  /** Branch within the pathway (Navy: Line/Engineering/Gunnery/Flight/
   *  Intelligence; etc.). Free-form string — editions define the set. */
  acgBranch: string | null = null;
  /** Military Occupational Specialty for Mercenary pathway characters.
   *  Free-form string. */
  acgMos: string | null = null;
  /** Decorations earned (MCUF, MCG, SEH from the Decoration & Survival
   *  table). */
  decorations: string[] = [];
  /** ACG brownie points — one-use DMs that can be spent post-roll. */
  browniePoints = 0;
  /** Specialist schools attended through ACG, e.g., "Combat Engineer
   *  School", "Intelligence School". */
  schoolsAttended: string[] = [];

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
    this.pendingChoices.push({ id: genChoiceId(), ...req });
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
    let preferredService: ServiceKey;
    if (method && method !== "random") {
      preferredService = method as ServiceKey;
    } else {
      preferredService = enlistable[Math.floor(Math.random() * enlistable.length)]!;
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
    this.terms += 1;
    this.age += 4;
    this.verboseHistory("--------------------------------------------");
    this.verboseHistory(`Term ${this.terms} age ${this.age}`);
    // Delegate the step sequence to the engine runner, which reads the
    // active edition's lifecycle.terms declaration from JSON. Adding
    // edition-specific steps (MT specialDuty, etc.) requires no change here.
    runTermSteps(this);
  }

  // ---------- reenlistment ----------

  doReenlistmentStep() {
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

    // Pick the highest row whose endOfTerm <= this.terms. Aging fires once
    // per term, at the end of the term (i.e., after this.terms has been
    // incremented for the term just completed).
    const applicable = aging.rows
      .filter((r) => this.terms >= r.endOfTerm)
      .sort((a, b) => b.endOfTerm - a.endOfTerm)[0];
    if (!applicable) return;

    for (const [attr, eff] of Object.entries(applicable.effects) as
      [AttributeKey, { delta: number; save: number }][]) {
      this.ageAttribute(attr, eff.save, eff.delta);
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

  musterOutRolls(): number {
    // Reads rules.musterOutRolls from the active edition.
    //   perTerm × terms (default 1) + the additionalRolls of whichever
    //   rankBand contains this character's rank.
    const rules = (
      getEdition(this.editionId).data.rules as {
        musterOutRolls?: {
          perTerm?: number;
          rankBands?: { ranks: number[]; additionalRolls: number }[];
        };
      }
    ).musterOutRolls;
    const perTerm = rules?.perTerm ?? 1;
    let r = perTerm * this.terms;
    const band = rules?.rankBands?.find((b) => b.ranks.includes(this.rank));
    if (band) r += band.additionalRolls;
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
    if (this.terms >= 5 && this.service !== "scouts" && this.service !== "other") {
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
