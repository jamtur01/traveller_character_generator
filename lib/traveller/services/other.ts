import type { ServiceDef } from "../types";
import { roll } from "../random";
import { cascadeBlade, cascadeGun, cascadeVehicle } from "../cascades";
import { survivalCheck } from "./common";

export const other: ServiceDef = {
  serviceName: "Other",
  memberName: "",
  enlistmentThrow: 3,
  enlistmentDM: () => 0,
  survivalThrow: 5,
  reenlistThrow: 5,
  ranks: { 0: "", 1: "", 2: "", 3: "", 4: "", 5: "", 6: "" },
  getServiceSkills: () => [],
  checkSurvival: (ch) => survivalCheck(ch, 5, ch.attributes.intelligence >= 9 ? 2 : 0),
  checkCommission: () => false,
  checkPromotion: () => false,
  doPromotion: () => {},
  musterCash: { 1: 1000, 2: 5000, 3: 10000, 4: 10000, 5: 10000, 6: 50000, 7: 100000 },
  musterBenefits: (ch, dm) => {
    switch (roll(1) + dm) {
      case 1: ch.addBenefit("Low Passage"); break;
      case 2: ch.improveAttribute("intelligence", 1); break;
      case 3: ch.improveAttribute("education", 1); break;
      case 4: ch.doGunBenefit(); break;
      case 5: ch.addBenefit("High Passage"); break;
      default: ch.debugHistory("No benefit");
    }
  },
  acquireSkill: (ch) => {
    switch (ch.whichSkillTable()) {
      case 1:
        switch (roll(1)) {
          case 1: ch.improveAttribute("strength", 1); break;
          case 2: ch.improveAttribute("dexterity", 1); break;
          case 3: ch.improveAttribute("endurance", 1); break;
          case 4: ch.addSkill(cascadeBlade(ch)); break;
          case 5: ch.addSkill("Brawling"); break;
          default: ch.improveAttribute("social", -1);
        }
        break;
      case 2:
        switch (roll(1)) {
          case 1: ch.addSkill(cascadeVehicle(ch)); break;
          case 2: ch.addSkill("Gambling"); break;
          case 3: ch.addSkill("Brawling"); break;
          case 4: ch.addSkill("Bribery"); break;
          case 5: ch.addSkill(cascadeBlade(ch)); break;
          default: ch.addSkill(cascadeGun(ch));
        }
        break;
      case 3:
        switch (roll(1)) {
          case 1: ch.addSkill("Streetwise"); break;
          case 2: ch.addSkill("Mechanical"); break;
          case 3: ch.addSkill("Electronic"); break;
          case 4: ch.addSkill("Gambling"); break;
          case 5: ch.addSkill("Brawling"); break;
          default: ch.addSkill("Forgery");
        }
        break;
      case 4:
        switch (roll(1)) {
          case 1: ch.addSkill("Medical"); break;
          case 2: ch.addSkill("Forgery"); break;
          case 3: ch.addSkill("Electronic"); break;
          case 4: ch.addSkill("Computer"); break;
          case 5: ch.addSkill("Streetwise"); break;
          default: ch.addSkill("Jack-o-T");
        }
        break;
    }
  },
};
