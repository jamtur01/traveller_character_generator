import type { ServiceDef } from "../types";
import { roll } from "../random";
import { cascadeBlade, cascadeGun, cascadeVehicle } from "../cascades";
import { survivalCheck } from "./common";

export const hunters: ServiceDef = {
  serviceName: "Hunter",
  memberName: "Hunter",
  enlistmentThrow: 9,
  enlistmentDM: (a) => (a.dexterity >= 10 ? 1 : 0) + (a.endurance >= 9 ? 2 : 0),
  survivalThrow: 6,
  reenlistThrow: 5,
  ranks: { 0: "", 1: "", 2: "", 3: "", 4: "", 5: "", 6: "" },
  getServiceSkills: () => ["Hunting"],
  checkSurvival: (ch) => survivalCheck(ch, 6, ch.attributes.strength >= 10 ? 2 : 0),
  checkCommission: () => false,
  checkPromotion: () => false,
  doPromotion: () => {},
  musterCash: { 1: 1000, 2: 1000, 3: 5000, 4: 5000, 5: 10000, 6: 100000, 7: 100000 },
  musterBenefits: (ch, dm) => {
    switch (roll(1) + dm) {
      case 1: ch.addBenefit("Low Passage"); break;
      case 2: ch.addBenefit("High Passage"); break;
      case 3: ch.doWeaponBenefit(); break;
      case 4: ch.doWeaponBenefit(); break;
      case 5: ch.doWeaponBenefit(); break;
      default:
        if (ch.benefits.indexOf("Safari Ship") > -1) {
          ch.debugHistory("No benefit");
          break;
        }
        ch.addBenefit("Safari Ship");
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
          case 5: ch.addSkill(cascadeGun(ch)); break;
          default: ch.addSkill(cascadeBlade(ch));
        }
        break;
      case 2:
        switch (roll(1)) {
          case 1: ch.addSkill(cascadeGun(ch)); break;
          case 2: ch.addSkill(cascadeBlade(ch)); break;
          case 3: ch.addSkill("Survival"); break;
          case 4: ch.addSkill("Hunting"); break;
          case 5: ch.addSkill(cascadeVehicle(ch)); break;
          default: ch.addSkill("Hunting");
        }
        break;
      case 3:
        switch (roll(1)) {
          case 1: ch.addSkill("Mechanical"); break;
          case 2: ch.addSkill("Electronic"); break;
          case 3: ch.addSkill("Gravitics"); break;
          case 4: ch.addSkill("Computer"); break;
          case 5: ch.addSkill("Hunting"); break;
          default: ch.addSkill("Admin");
        }
        break;
      case 4:
        switch (roll(1)) {
          case 1: ch.addSkill("Medical"); break;
          case 2: ch.addSkill("Computer"); break;
          case 3: ch.addSkill("Hunting"); break;
          case 4: ch.addSkill("Leader"); break;
          case 5: ch.addSkill("Survival"); break;
          default: ch.addSkill("Admin");
        }
        break;
    }
  },
};
