import type { ServiceDef } from "../types";
import { roll } from "../random";
import { cascadeBlade, cascadeGun, cascadeVehicle } from "../cascades";
import { commissionCheck, promotionCheck, survivalCheck } from "./common";

export const marines: ServiceDef = {
  serviceName: "Marines",
  memberName: "Marine",
  enlistmentThrow: 9,
  enlistmentDM: (a) => (a.intelligence >= 8 ? 1 : 0) + (a.strength >= 8 ? 2 : 0),
  survivalThrow: 6,
  commissionThrow: 9,
  promotionThrow: 9,
  reenlistThrow: 6,
  ranks: {
    0: "", 1: "Lieutenant", 2: "Captain", 3: "Force Cmdr",
    4: "Lt Colonel", 5: "Colonel", 6: "Brigadier",
  },
  getServiceSkills: () => ["Cutlass"],
  checkSurvival: (ch) => survivalCheck(ch, 6, ch.attributes.endurance >= 8 ? 2 : 0),
  checkCommission: (ch) => commissionCheck(ch, 9, ch.attributes.education >= 7 ? 1 : 0),
  checkPromotion: (ch) => promotionCheck(ch, 9, ch.attributes.social >= 8 ? 1 : 0),
  doPromotion: (ch) => {
    if (ch.rank === 1) ch.addSkill("Revolver");
  },
  musterCash: { 1: 2000, 2: 5000, 3: 5000, 4: 10000, 5: 20000, 6: 30000, 7: 40000 },
  musterBenefits: (ch, dm) => {
    switch (roll(1) + dm) {
      case 1: ch.addBenefit("Low Passage"); break;
      case 2: ch.improveAttribute("intelligence", 2); break;
      case 3: ch.improveAttribute("education", 1); break;
      case 4: ch.doBladeBenefit(); break;
      case 5:
        if (ch.benefits.indexOf("Travellers' Aid Society") > -1) break;
        ch.addBenefit("Travellers' Aid Society");
        ch.TAS = true;
        break;
      case 6: ch.addBenefit("High Passage"); break;
      default: ch.improveAttribute("social", 2);
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
          default: ch.addSkill(cascadeBlade(ch));
        }
        break;
      case 2:
        switch (roll(1)) {
          case 1: ch.addSkill("ATV"); break;
          case 2: ch.addSkill("Vacc Suit"); break;
          case 3: ch.addSkill(cascadeBlade(ch)); break;
          case 4: ch.addSkill(cascadeGun(ch)); break;
          case 5: ch.addSkill(cascadeBlade(ch)); break;
          default: ch.addSkill(cascadeGun(ch));
        }
        break;
      case 3:
        switch (roll(1)) {
          case 1: ch.addSkill(cascadeVehicle(ch)); break;
          case 2: ch.addSkill("Mechanical"); break;
          case 3: ch.addSkill("Electronic"); break;
          case 4: ch.addSkill("Tactics"); break;
          case 5: ch.addSkill(cascadeBlade(ch)); break;
          default: ch.addSkill(cascadeGun(ch));
        }
        break;
      case 4:
        switch (roll(1)) {
          case 1: ch.addSkill("Medical"); break;
          case 2: ch.addSkill("Tactics"); break;
          case 3: ch.addSkill("Tactics"); break;
          case 4: ch.addSkill("Computer"); break;
          case 5: ch.addSkill("Leader"); break;
          default: ch.addSkill("Admin");
        }
        break;
    }
  },
};
