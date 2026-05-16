import type { ServiceDef } from "../types";
import { roll } from "../random";
import { cascadeBlade, cascadeGun, cascadeVehicle } from "../cascades";
import { commissionCheck, promotionCheck, survivalCheck } from "./common";

export const bureaucrats: ServiceDef = {
  serviceName: "Bureaucrat",
  memberName: "Bureaucrat",
  enlistmentThrow: 5,
  enlistmentDM: (a) => (a.education >= 8 ? 1 : 0) + (a.strength <= 8 ? 2 : 0),
  survivalThrow: 4,
  commissionThrow: 6,
  promotionThrow: 7,
  // CotI: must throw 3+ to LEAVE the bureaucracy before retirement.
  reenlistThrow: 3,
  inverseReenlist: true,
  ranks: {
    0: "", 1: "Clerk", 2: "Supervisor", 3: "Asst Manager",
    4: "Manager", 5: "Executive", 6: "Director",
  },
  getServiceSkills: () => [],
  checkSurvival: (ch) => survivalCheck(ch, 4, ch.attributes.education >= 10 ? 2 : 0),
  checkCommission: (ch) => commissionCheck(ch, 6, ch.attributes.social >= 9 ? 1 : 0),
  checkPromotion: (ch) => promotionCheck(ch, 7, ch.attributes.intelligence >= 9 ? 1 : 0),
  doPromotion: () => {},
  musterCash: { 1: 0, 2: 0, 3: 10000, 4: 10000, 5: 40000, 6: 40000, 7: 80000 },
  musterBenefits: (ch, dm) => {
    switch (roll(1) + dm) {
      case 1: ch.addBenefit("Low Passage"); break;
      case 2: ch.addBenefit("Mid Passage"); break;
      case 3: break;
      case 4:
        if (ch.benefits.indexOf("Watch") > -1) break;
        ch.addBenefit("Watch");
        break;
      case 5: break;
      case 6: ch.addBenefit("High Passage"); break;
      default: ch.improveAttribute("social", 1);
    }
  },
  acquireSkill: (ch) => {
    switch (ch.whichSkillTable()) {
      case 1:
        switch (roll(1)) {
          case 1: ch.improveAttribute("endurance", 1); break;
          case 2: ch.improveAttribute("education", 1); break;
          case 3: ch.improveAttribute("intelligence", 1); break;
          case 4: ch.addSkill("Brawling"); break;
          case 5: ch.addSkill("Carousing"); break;
          default: ch.improveAttribute("dexterity", 1);
        }
        break;
      case 2:
        switch (roll(1)) {
          case 1: ch.addSkill(cascadeGun(ch)); break;
          case 2: ch.addSkill(cascadeVehicle(ch)); break;
          case 3: ch.addSkill(cascadeBlade(ch)); break;
          case 4: ch.addSkill("Instruction"); break;
          case 5: ch.addSkill(cascadeVehicle(ch)); break;
          default: ch.improveAttribute("education", 1);
        }
        break;
      case 3:
        switch (roll(1)) {
          case 1: ch.addSkill("Recruiting"); break;
          case 2: ch.addSkill(cascadeVehicle(ch)); break;
          case 3: ch.addSkill("Liaison"); break;
          case 4: ch.addSkill("Interrogation"); break;
          case 5: ch.addSkill("Admin"); break;
          default: ch.addSkill("Admin");
        }
        break;
      case 4:
        switch (roll(1)) {
          case 1: ch.addSkill("Admin"); break;
          case 2: ch.addSkill("Admin"); break;
          case 3: ch.addSkill("Computer"); break;
          case 4: ch.addSkill("Admin"); break;
          case 5: ch.addSkill("Jack-o-T"); break;
          default: ch.addSkill("Leader");
        }
        break;
    }
  },
};
