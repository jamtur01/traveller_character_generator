import type { ServiceDef } from "../types";
import { roll } from "../random";
import { cascadeBlade, cascadeGun, cascadeVehicle } from "../cascades";
import { commissionCheck, promotionCheck, survivalCheck } from "./common";

export const diplomats: ServiceDef = {
  serviceName: "Diplomats",
  memberName: "Diplomat",
  enlistmentThrow: 8,
  enlistmentDM: (a) => (a.education >= 8 ? 1 : 0) + (a.social >= 9 ? 2 : 0),
  survivalThrow: 3,
  commissionThrow: 5,
  promotionThrow: 10,
  reenlistThrow: 5,
  ranks: {
    0: "", 1: "3d Secretary", 2: "2d Secretary", 3: "1st Secretary",
    4: "Counselor", 5: "Minister", 6: "Ambassador",
  },
  getServiceSkills: () => ["Liaison"],
  checkSurvival: (ch) => survivalCheck(ch, 3, ch.attributes.education >= 9 ? 2 : 0),
  checkCommission: (ch) => commissionCheck(ch, 5, ch.attributes.intelligence >= 8 ? 1 : 0),
  checkPromotion: (ch) => promotionCheck(ch, 10, ch.attributes.social >= 10 ? 1 : 0),
  doPromotion: () => {},
  musterCash: { 1: 10000, 2: 10000, 3: 10000, 4: 20000, 5: 50000, 6: 60000, 7: 70000 },
  musterBenefits: (ch, dm) => {
    switch (roll(1) + dm) {
      case 1: ch.addBenefit("Low Passage"); break;
      case 2: ch.improveAttribute("intelligence", 1); break;
      case 3: ch.improveAttribute("education", 2); break;
      case 4: ch.doWeaponBenefit(); break;
      case 5: ch.improveAttribute("social", 1); break;
      case 6: ch.addBenefit("High Passage"); break;
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
          case 2: ch.improveAttribute("education", 1); break;
          case 3: ch.improveAttribute("intelligence", 1); break;
          case 4: ch.addSkill(cascadeBlade(ch)); break;
          case 5: ch.addSkill(cascadeGun(ch)); break;
          default: ch.addSkill("Carousing");
        }
        break;
      case 2:
        switch (roll(1)) {
          case 1: ch.improveAttribute("intelligence", 1); break;
          case 2: ch.addSkill("Vacc Suit"); break;
          case 3: ch.addSkill(cascadeVehicle(ch)); break;
          case 4: ch.addSkill(cascadeVehicle(ch)); break;
          case 5: ch.addSkill("Gambling"); break;
          default: ch.addSkill("Computer");
        }
        break;
      case 3:
        switch (roll(1)) {
          case 1: ch.addSkill("Forgery"); break;
          case 2: ch.addSkill("Streetwise"); break;
          case 3: ch.addSkill("Interrogation"); break;
          case 4: ch.addSkill("Recruiting"); break;
          case 5: ch.addSkill("Instruction"); break;
          default: ch.addSkill("Admin");
        }
        break;
      case 4:
        switch (roll(1)) {
          case 1: ch.addSkill("Liaison"); break;
          case 2: ch.addSkill("Liaison"); break;
          case 3: ch.addSkill("Admin"); break;
          case 4: ch.addSkill("Computer"); break;
          case 5: ch.improveAttribute("social", 1); break;
          default: ch.addSkill("Jack-o-T");
        }
        break;
    }
  },
};
