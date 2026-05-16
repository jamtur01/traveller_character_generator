import type { ServiceDef } from "../types";
import { roll } from "../random";
import { cascadeBlade, cascadeGun, cascadeVehicle } from "../cascades";
import { survivalCheck } from "./common";

export const scientists: ServiceDef = {
  serviceName: "Scientist",
  memberName: "Scientist",
  enlistmentThrow: 6,
  enlistmentDM: (a) => (a.intelligence >= 9 ? 1 : 0) + (a.education >= 10 ? 2 : 0),
  survivalThrow: 5,
  reenlistThrow: 5,
  ranks: { 0: "", 1: "", 2: "", 3: "", 4: "", 5: "", 6: "" },
  getServiceSkills: () => ["Computer"],
  checkSurvival: (ch) => survivalCheck(ch, 5, ch.attributes.education >= 9 ? 2 : 0),
  checkCommission: () => false,
  checkPromotion: () => false,
  doPromotion: () => {},
  musterCash: { 1: 1000, 2: 2000, 3: 5000, 4: 10000, 5: 20000, 6: 30000, 7: 40000 },
  musterBenefits: (ch, dm) => {
    switch (roll(1) + dm) {
      case 1: ch.addBenefit("Low Passage"); break;
      case 2: ch.addBenefit("Mid Passage"); break;
      case 3: ch.addBenefit("High Passage"); break;
      case 4: ch.improveAttribute("social", 1); break;
      case 5: ch.doGunBenefit(); break;
      default:
        if (ch.benefits.indexOf("Lab Ship") > -1) {
          ch.debugHistory("No benefit");
          break;
        }
        ch.addBenefit("Lab Ship");
        ch.ship = true;
    }
  },
  acquireSkill: (ch) => {
    switch (ch.whichSkillTable()) {
      case 1:
        switch (roll(1)) {
          case 1: ch.improveAttribute("strength", 1); break;
          case 2: ch.improveAttribute("dexterity", 1); break;
          case 3: ch.improveAttribute("endurance", 1); break;
          case 4: ch.improveAttribute("intelligence", 1); break;
          case 5: ch.improveAttribute("education", 1); break;
          default: ch.addSkill("Carousing");
        }
        break;
      case 2:
        switch (roll(1)) {
          case 1: ch.addSkill(cascadeGun(ch)); break;
          case 2: ch.addSkill(cascadeBlade(ch)); break;
          case 3: ch.addSkill(cascadeVehicle(ch)); break;
          case 4: ch.addSkill("Jack-o-T"); break;
          case 5: ch.addSkill("Navigation"); break;
          default: ch.addSkill("Survival");
        }
        break;
      case 3:
        switch (roll(1)) {
          case 1: ch.addSkill("Mechanical"); break;
          case 2: ch.addSkill("Electronic"); break;
          case 3: ch.addSkill("Gravitics"); break;
          case 4: ch.addSkill("Computer"); break;
          case 5: ch.improveAttribute("intelligence", 1); break;
          default: ch.improveAttribute("education", 1);
        }
        break;
      case 4:
        switch (roll(1)) {
          case 1: ch.addSkill("Medical"); break;
          case 2: ch.addSkill("Computer"); break;
          case 3: ch.addSkill("Admin"); break;
          case 4: ch.addSkill("Leader"); break;
          case 5: ch.improveAttribute("intelligence", 1); break;
          default: ch.addSkill("Jack-o-T");
        }
        break;
    }
  },
};
