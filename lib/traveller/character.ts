// The Character class: rolls, terms, skills, muster-out. Service-specific
// tables live in `./services/*` and are looked up via the `s` registry inside
// method bodies (avoids module-load cycles).

import { rndInt, roll } from "./random";
import { cascadeBlade, cascadeGun } from "./cascades";
import { generateGender, generateName } from "./names";
import { attrShort, extendedHex, intToOrdinal, numCommaSep } from "./formatting";
import type {
  AttributeKey,
  Attributes,
  Gender,
  ServiceKey,
  ShowHistory,
  Skill,
} from "./types";
import { DRAFT_SERVICES, SERVICES, s } from "./services";
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
    if (this.bladeBenefit === "") {
      this.bladeBenefit = cascadeBlade(this);
      this.addBenefit(this.bladeBenefit);
      this.addSkill(this.bladeBenefit, 0);
    } else {
      this.addSkill(this.bladeBenefit);
    }
  }

  doGunBenefit() {
    if (this.gunBenefit === "") {
      this.gunBenefit = cascadeGun(this);
      this.addBenefit(this.gunBenefit);
      this.addSkill(this.gunBenefit, 0);
    } else {
      this.addSkill(this.gunBenefit);
    }
  }

  /**
   * CotI generic "Weapon" benefit: character may pick any personal weapon from
   * Book 1 (blades or guns). Since we have no UI prompt in a procedural roll,
   * pick 50/50 between blade and gun and then cascade as normal.
   */
  doWeaponBenefit() {
    if (roll(1) <= 3) this.doBladeBenefit();
    else this.doGunBenefit();
  }

  // ---------- enlistment ----------

  doEnlistment(method: string): ServiceKey {
    let preferredService: ServiceKey;
    if (method && method !== "random") {
      preferredService = method as ServiceKey;
    } else {
      preferredService = SERVICES[Math.floor(Math.random() * SERVICES.length)]!;
    }

    // CotI: Soc 10+ characters are automatically enrolled in the Nobility.
    if (this.attributes.social >= 10 && (!method || method === "random")) {
      this.history.push(
        "Distinguished by social standing, automatically enrolled in the Nobility.",
      );
      const skills = s.nobles.getServiceSkills(this);
      for (const sk of skills) this.addSkill(sk);
      return "nobles";
    }

    const dm = s[preferredService].enlistmentDM(this.attributes);
    const en = roll(2);
    this.history.push(`Attempted to enlist in ${s[preferredService].serviceName}.`);
    this.verboseHistory(
      `Enlistment roll ${en} + ${dm} vs ${s[preferredService].enlistmentThrow}`,
    );
    if (en + dm >= s[preferredService].enlistmentThrow) {
      this.history.push("Enlistment accepted.");
      this.applyServiceStartAge(preferredService);
      const skills = s[preferredService].getServiceSkills(this);
      for (const sk of skills) this.addSkill(sk);
      return preferredService;
    }
    this.drafted = true;
    this.history.push("Enlistment denied.");
    const draftService =
      DRAFT_SERVICES[Math.floor(Math.random() * DRAFT_SERVICES.length)]!;
    this.history.push(`Drafted into ${draftService}.`);
    this.applyServiceStartAge(draftService);
    const skills = s[draftService].getServiceSkills(this);
    for (const sk of skills) this.addSkill(sk);
    return draftService;
  }

  /** CotI p. 2: belters and barbarians begin their careers at age 14. */
  private applyServiceStartAge(svc: ServiceKey) {
    if (svc === "belters" || svc === "barbarians") this.age = 14;
  }

  // ---------- service term ----------

  doServiceTermStep() {
    // A mandatory reenlistment is consumed by serving the term it forced.
    this.mandatoryReenlistment = false;
    this.terms += 1;
    this.age += 4;
    this.verboseHistory("--------------------------------------------");
    this.verboseHistory(`Term ${this.terms} age ${this.age}`);

    const svc = this.service;
    if (
      svc === "scouts" || svc === "belters" || svc === "doctors" ||
      svc === "rogues" || svc === "scientists" || svc === "hunters"
    ) {
      this.skillPoints += 2;
    } else if (this.terms === 1) {
      this.skillPoints += 2;
    } else {
      this.skillPoints += 1;
    }

    // TTB p. 24 checklist order: survival → commission → promotion → skills.
    if (!s[this.service].checkSurvival(this)) {
      this.history.push("Death in service.");
      this.deceased = true;
      this.activeDuty = false;
      return;
    }

    if (this.drafted && this.terms === 1) {
      this.verboseHistory("Skipping commission because of draft.");
    } else if (!this.commissioned) {
      if (s[this.service].checkCommission(this)) {
        this.commissioned = true;
        this.rank += 1;
        this.skillPoints += 1;
        s[this.service].doPromotion(this);
        this.history.push(
          `Commissioned during ${intToOrdinal(this.terms)} term of service as ${s[this.service].ranks[this.rank]}.`,
        );
      }
    }
    if (this.commissioned && this.rank < 6) {
      if (s[this.service].checkPromotion(this)) {
        this.rank += 1;
        this.skillPoints += 1;
        s[this.service].doPromotion(this);
        this.history.push(`Promoted to ${s[this.service].ranks[this.rank]}.`);
      }
    }
  }

  // ---------- reenlistment ----------

  doReenlistmentStep() {
    const def = s[this.service];
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
    if (this.age < 34) return;
    if (this.age <= 46) {
      this.ageAttribute("strength", 8, -1);
      this.ageAttribute("dexterity", 7, -1);
      this.ageAttribute("endurance", 8, -1);
    } else if (this.age <= 62) {
      this.ageAttribute("strength", 9, -1);
      this.ageAttribute("dexterity", 8, -1);
      this.ageAttribute("endurance", 9, -1);
    } else {
      this.ageAttribute("strength", 9, -2);
      this.ageAttribute("dexterity", 9, -2);
      this.ageAttribute("endurance", 9, -2);
      this.ageAttribute("intelligence", 9, -1);
    }
    for (const a of Object.keys(this.attributes) as AttributeKey[]) {
      if (this.attributes[a] < 1) {
        const cr = roll(2);
        this.verboseHistory(
          `Aging crisis due to ${a} dropping below 1 roll ${cr} vs 8`,
        );
        if (cr < 8) {
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
    let r = this.terms;
    if (this.rank === 1 || this.rank === 2) r += 1;
    else if (this.rank === 3 || this.rank === 4) r += 2;
    else if (this.rank >= 5) r += 3;
    return r;
  }

  musterOutCash(cashDM: number) {
    const idx = Math.min(7, Math.max(1, roll(1) + cashDM));
    const cash = s[this.service].musterCash[idx] ?? 0;
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

    s[this.service].musterBenefits(this, benefitsDM);

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
