import type { ServiceDef } from "../types";
import { roll } from "../random";
import { survivalCheck } from "./common";

export const belters: ServiceDef = {
  serviceName: "Belters",
  memberName: "Belter",
  enlistmentThrow: 8,
  enlistmentDM: (a) => (a.dexterity >= 9 ? 1 : 0) + (a.intelligence >= 6 ? 2 : 0),
  survivalThrow: 9,
  reenlistThrow: 7,
  ranks: { 0: "", 1: "", 2: "", 3: "", 4: "", 5: "", 6: "" },
  getServiceSkills: () => ["Vacc Suit"],
  // Belter survival DM scales with terms served (CotI footnote).
  checkSurvival: (ch) => survivalCheck(ch, 9, ch.terms),
  checkCommission: () => false,
  checkPromotion: () => false,
  doPromotion: () => {},
  musterCash: { 1: 0, 2: 0, 3: 1000, 4: 10000, 5: 100000, 6: 100000, 7: 100000 },
  musterBenefits: (ch, dm) => {
    switch (roll(1) + dm) {
      case 1: ch.addBenefit("Low Passage"); break;
      case 2: ch.improveAttribute("intelligence", 1); break;
      case 3: ch.doWeaponBenefit(); break;
      case 4: ch.addBenefit("High Passage"); break;
      case 5:
        if (ch.benefits.indexOf("Travellers' Aid Society") > -1) break;
        ch.addBenefit("Travellers' Aid Society");
        ch.TAS = true;
        break;
      case 6:
        if (ch.benefits.indexOf("Seeker") > -1) {
          ch.debugHistory("No benefit");
          break;
        }
        ch.addBenefit("Seeker");
        ch.ship = true;
        break;
      default: break;
    }
  },
  acquireSkill: (ch) => {
    switch (ch.whichSkillTable()) {
      case 1:
        switch (roll(1)) {
          case 1: ch.improveAttribute("strength", 1); break;
          case 2: ch.improveAttribute("dexterity", 1); break;
          case 3: ch.improveAttribute("endurance", 1); break;
          case 4: ch.addSkill("Gambling"); break;
          case 5: ch.addSkill("Brawling"); break;
          default: ch.addSkill("Vacc Suit");
        }
        break;
      case 2:
        switch (roll(1)) {
          case 1: ch.addSkill("Vacc Suit"); break;
          case 2: ch.addSkill("Vacc Suit"); break;
          case 3: ch.addSkill("Prospecting"); break;
          case 4: ch.addSkill("Fwd Obsvr"); break;
          case 5: ch.addSkill("Prospecting"); break;
          default: ch.addSkill("Ship's Boat");
        }
        break;
      case 3:
        switch (roll(1)) {
          case 1: ch.addSkill("Ship's Boat"); break;
          case 2: ch.addSkill("Electronic"); break;
          case 3: ch.addSkill("Prospecting"); break;
          case 4: ch.addSkill("Mechanical"); break;
          case 5: ch.addSkill("Prospecting"); break;
          default: ch.addSkill("Instruction");
        }
        break;
      case 4:
        switch (roll(1)) {
          case 1: ch.addSkill("Navigation"); break;
          case 2: ch.addSkill("Medical"); break;
          case 3: ch.addSkill("Pilot"); break;
          case 4: ch.addSkill("Computer"); break;
          case 5: ch.addSkill("Engineering"); break;
          default: ch.addSkill("Jack-o-T");
        }
        break;
    }
  },
};
