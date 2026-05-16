import type { ServiceDef } from "../types";
import { roll } from "../random";
import { cascadeGun, cascadeVehicle, cascadeWatercraft } from "../cascades";
import { commissionCheck, promotionCheck, survivalCheck } from "./common";

export const sailors: ServiceDef = {
  serviceName: "Sailors",
  memberName: "Sailor",
  enlistmentThrow: 6,
  enlistmentDM: (a) => (a.endurance >= 10 ? 1 : 0) + (a.strength >= 8 ? 2 : 0),
  survivalThrow: 5,
  commissionThrow: 5,
  promotionThrow: 6,
  reenlistThrow: 6,
  ranks: {
    0: "", 1: "Ensign", 2: "Lieutenant", 3: "Lt Cmdr",
    4: "Commander", 5: "Captain", 6: "Admiral",
  },
  getServiceSkills: () => [],
  checkSurvival: (ch) => survivalCheck(ch, 5, ch.attributes.endurance >= 8 ? 2 : 0),
  checkCommission: (ch) => commissionCheck(ch, 5, ch.attributes.intelligence >= 9 ? 1 : 0),
  checkPromotion: (ch) => promotionCheck(ch, 6, ch.attributes.education >= 8 ? 1 : 0),
  doPromotion: () => {},
  musterCash: { 1: 2000, 2: 5000, 3: 10000, 4: 10000, 5: 10000, 6: 20000, 7: 30000 },
  musterBenefits: (ch, dm) => {
    switch (roll(1) + dm) {
      case 1: ch.addBenefit("Low Passage"); break;
      case 2: ch.improveAttribute("education", 1); break;
      case 3: ch.doWeaponBenefit(); break;
      case 4: ch.doWeaponBenefit(); break;
      case 5: ch.addBenefit("High Passage"); break;
      case 6: ch.addBenefit("High Passage"); break;
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
          case 4: ch.addSkill("Gambling"); break;
          case 5: ch.addSkill("Brawling"); break;
          default: ch.addSkill("Carousing");
        }
        break;
      case 2:
        switch (roll(1)) {
          case 1: ch.addSkill(cascadeGun(ch)); break;
          case 2: ch.addSkill("Commo"); break;
          case 3: ch.addSkill("Fwd Obsvr"); break;
          case 4: ch.addSkill(cascadeVehicle(ch)); break;
          case 5: ch.addSkill(cascadeVehicle(ch)); break;
          default: ch.addSkill("Battle Dress");
        }
        break;
      case 3:
        switch (roll(1)) {
          case 1: ch.addSkill(cascadeWatercraft(ch)); break;
          case 2: ch.addSkill("Electronic"); break;
          case 3: ch.addSkill("Mechanical"); break;
          case 4: ch.addSkill("Gravitics"); break;
          case 5: ch.addSkill("Navigation"); break;
          default: ch.addSkill("Demolition");
        }
        break;
      case 4:
        switch (roll(1)) {
          case 1: ch.addSkill("Medical"); break;
          case 2: ch.addSkill(cascadeVehicle(ch)); break;
          case 3: ch.addSkill("Streetwise"); break;
          case 4: ch.addSkill("Computer"); break;
          case 5: ch.addSkill("Admin"); break;
          default: ch.addSkill("Jack-o-T");
        }
        break;
    }
  },
};
