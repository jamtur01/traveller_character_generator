import type { ServiceDef } from "../types";
import { roll } from "../random";
import {
  cascadeAircraft, cascadeGun, cascadeServiceAircraft, cascadeVehicle,
} from "../cascades";
import { commissionCheck, promotionCheck, survivalCheck } from "./common";

export const flyers: ServiceDef = {
  serviceName: "Flyers",
  memberName: "Flyer",
  enlistmentThrow: 6,
  enlistmentDM: (a) => (a.strength >= 7 ? 1 : 0) + (a.dexterity >= 9 ? 2 : 0),
  survivalThrow: 5,
  commissionThrow: 5,
  promotionThrow: 8,
  reenlistThrow: 6,
  ranks: {
    0: "", 1: "Pilot", 2: "Flight Leader", 3: "Sqdrn Leader",
    4: "Staff Major", 5: "Group Leader", 6: "Air Marshal",
  },
  // Pick the flyer's starting aircraft type when they enlist; cached per call
  // so it can't shift if anything ever re-invokes the function.
  getServiceSkills: () => [cascadeServiceAircraft()],
  checkSurvival: (ch) => survivalCheck(ch, 5, ch.attributes.dexterity >= 8 ? 2 : 0),
  checkCommission: (ch) => commissionCheck(ch, 5, ch.attributes.education >= 6 ? 1 : 0),
  checkPromotion: (ch) => promotionCheck(ch, 8, ch.attributes.education >= 8 ? 1 : 0),
  doPromotion: () => {},
  musterCash: { 1: 2000, 2: 5000, 3: 10000, 4: 10000, 5: 10000, 6: 20000, 7: 30000 },
  musterBenefits: (ch, dm) => {
    switch (roll(1) + dm) {
      case 1: ch.addBenefit("Low Passage"); break;
      case 2: ch.improveAttribute("education", 1); break;
      case 3: ch.doWeaponBenefit(); break;
      case 4: ch.doWeaponBenefit(); break;
      case 5: ch.addBenefit("High Passage"); break;
      case 6: ch.addBenefit("Mid Passage"); break;
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
          case 1: ch.addSkill("Brawling"); break;
          case 2: ch.addSkill("Vacc Suit"); break;
          case 3: ch.addSkill(cascadeGun(ch)); break;
          case 4: ch.addSkill(cascadeVehicle(ch)); break;
          case 5: ch.addSkill(cascadeVehicle(ch)); break;
          default: ch.addSkill(cascadeVehicle(ch));
        }
        break;
      case 3:
        switch (roll(1)) {
          case 1: ch.addSkill(cascadeAircraft(ch)); break;
          case 2: ch.addSkill("Mechanical"); break;
          case 3: ch.addSkill("Electronic"); break;
          case 4: ch.addSkill("Gravitics"); break;
          case 5: ch.addSkill(cascadeGun(ch)); break;
          default: ch.addSkill("Survival");
        }
        break;
      case 4:
        switch (roll(1)) {
          case 1: ch.addSkill("Medical"); break;
          case 2: ch.addSkill("Leader"); break;
          case 3: ch.addSkill("Pilot"); break;
          case 4: ch.addSkill("Computer"); break;
          case 5: ch.addSkill("Admin"); break;
          default: ch.addSkill("Jack-o-T");
        }
        break;
    }
  },
};
