import type { ServiceDef } from "../types";
import { roll } from "../random";
import { cascadeBlade, cascadeGun, cascadeVehicle } from "../cascades";
import { survivalCheck } from "./common";

export const rogues: ServiceDef = {
  serviceName: "Rogue",
  memberName: "Rogue",
  enlistmentThrow: 6,
  enlistmentDM: (a) => (a.social <= 8 ? 1 : 0) + (a.endurance >= 7 ? 2 : 0),
  survivalThrow: 6,
  reenlistThrow: 5,
  ranks: { 0: "", 1: "", 2: "", 3: "", 4: "", 5: "", 6: "" },
  getServiceSkills: () => ["Streetwise"],
  checkSurvival: (ch) => survivalCheck(ch, 6, ch.attributes.intelligence >= 9 ? 2 : 0),
  checkCommission: () => false,
  checkPromotion: () => false,
  doPromotion: () => {},
  musterCash: { 1: 0, 2: 0, 3: 10000, 4: 10000, 5: 50000, 6: 100000, 7: 100000 },
  musterBenefits: (ch, dm) => {
    switch (roll(1) + dm) {
      case 1: ch.addBenefit("Low Passage"); break;
      case 2: ch.improveAttribute("social", 1); break;
      case 3: ch.doGunBenefit(); break;
      case 4: ch.doBladeBenefit(); break;
      case 5: ch.addBenefit("High Passage"); break;
      default:
        if (ch.benefits.indexOf("Travellers' Aid Society") > -1) break;
        ch.addBenefit("Travellers' Aid Society");
        ch.TAS = true;
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
          case 5: ch.addSkill("Brawling"); break;
          default: ch.addSkill("Carousing");
        }
        break;
      case 2:
        switch (roll(1)) {
          case 1: ch.addSkill(cascadeBlade(ch)); break;
          case 2: ch.addSkill(cascadeGun(ch)); break;
          case 3: ch.addSkill("Demolition"); break;
          case 4: ch.addSkill(cascadeVehicle(ch)); break;
          case 5: ch.improveAttribute("education", 1); break;
          default: ch.addSkill(cascadeVehicle(ch));
        }
        break;
      case 3:
        switch (roll(1)) {
          case 1: ch.addSkill("Streetwise"); break;
          case 2: ch.addSkill("Forgery"); break;
          case 3: ch.addSkill("Bribery"); break;
          case 4: ch.addSkill("Carousing"); break;
          case 5: ch.addSkill("Liaison"); break;
          default: ch.addSkill("Ship Tactics");
        }
        break;
      case 4:
        switch (roll(1)) {
          case 1: ch.addSkill("Medical"); break;
          case 2: ch.addSkill("Bribery"); break;
          case 3: ch.addSkill("Forgery"); break;
          case 4: ch.addSkill("Computer"); break;
          case 5: ch.addSkill("Leader"); break;
          default: ch.addSkill("Jack-o-T");
        }
        break;
    }
  },
};
