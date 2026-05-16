import type { ServiceDef } from "../types";
import { roll } from "../random";
import { cascadeGun, cascadeVehicle } from "../cascades";
import { survivalCheck } from "./common";

export const scouts: ServiceDef = {
  serviceName: "Scouts",
  memberName: "Scout",
  enlistmentThrow: 7,
  enlistmentDM: (a) => (a.intelligence >= 6 ? 1 : 0) + (a.strength >= 8 ? 2 : 0),
  survivalThrow: 7,
  reenlistThrow: 3,
  ranks: { 0: "", 1: "", 2: "", 3: "", 4: "", 5: "", 6: "" },
  getServiceSkills: () => ["Pilot"],
  checkSurvival: (ch) => survivalCheck(ch, 7, ch.attributes.endurance >= 9 ? 2 : 0),
  checkCommission: () => false,
  checkPromotion: () => false,
  doPromotion: () => {},
  musterCash: { 1: 20000, 2: 20000, 3: 30000, 4: 30000, 5: 50000, 6: 50000, 7: 50000 },
  musterBenefits: (ch, dm) => {
    switch (roll(1) + dm) {
      case 1: ch.addBenefit("Low Passage"); break;
      case 2: ch.improveAttribute("intelligence", 2); break;
      case 3: ch.improveAttribute("education", 2); break;
      case 4: ch.doBladeBenefit(); break;
      case 5: ch.doGunBenefit(); break;
      case 6:
        if (ch.benefits.indexOf("Scout Ship") > -1) {
          ch.debugHistory("No benefit");
          break;
        }
        ch.addBenefit("Scout Ship");
        ch.ship = true;
        break;
      default: ch.improveAttribute("social", 1);
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
          default: ch.addSkill(cascadeGun(ch));
        }
        break;
      case 2:
        switch (roll(1)) {
          case 1: ch.addSkill("Air/Raft"); break;
          case 2: ch.addSkill("Vacc Suit"); break;
          case 3: ch.addSkill("Mechanical"); break;
          case 4: ch.addSkill("Navigation"); break;
          case 5: ch.addSkill("Electronic"); break;
          default: ch.addSkill("Jack-o-T");
        }
        break;
      case 3:
        switch (roll(1)) {
          case 1: ch.addSkill(cascadeVehicle(ch)); break;
          case 2: ch.addSkill("Mechanical"); break;
          case 3: ch.addSkill("Electronic"); break;
          case 4: ch.addSkill("Jack-o-T"); break;
          case 5: ch.addSkill("Gunnery"); break;
          default: ch.addSkill("Medical");
        }
        break;
      case 4:
        switch (roll(1)) {
          case 1: ch.addSkill("Medical"); break;
          case 2: ch.addSkill("Navigation"); break;
          case 3: ch.addSkill("Engineering"); break;
          case 4: ch.addSkill("Computer"); break;
          case 5: ch.addSkill("Pilot"); break;
          default: ch.addSkill("Jack-o-T");
        }
        break;
    }
  },
};
