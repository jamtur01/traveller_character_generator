import type { ServiceDef } from "../types";
import { roll } from "../random";
import { cascadeBlade, cascadeGun, cascadeVehicle } from "../cascades";
import { commissionCheck, promotionCheck, survivalCheck } from "./common";

export const army: ServiceDef = {
  serviceName: "Army",
  memberName: "Army",
  enlistmentThrow: 5,
  enlistmentDM: (a) => (a.dexterity >= 6 ? 1 : 0) + (a.endurance >= 5 ? 2 : 0),
  survivalThrow: 5,
  commissionThrow: 5,
  promotionThrow: 6,
  reenlistThrow: 7,
  ranks: {
    0: "", 1: "Lieutenant", 2: "Captain", 3: "Major",
    4: "Lt Colonel", 5: "Colonel", 6: "General",
  },
  getServiceSkills: () => ["Rifle"],
  checkSurvival: (ch) => survivalCheck(ch, 5, ch.attributes.education >= 6 ? 2 : 0),
  checkCommission: (ch) => commissionCheck(ch, 5, ch.attributes.endurance >= 7 ? 1 : 0),
  checkPromotion: (ch) => promotionCheck(ch, 6, ch.attributes.education >= 7 ? 1 : 0),
  doPromotion: (ch) => {
    if (ch.rank === 1) ch.addSkill("SMG");
  },
  musterCash: { 1: 2000, 2: 5000, 3: 10000, 4: 10000, 5: 10000, 6: 20000, 7: 30000 },
  musterBenefits: (ch, dm) => {
    switch (roll(1) + dm) {
      case 1: ch.addBenefit("Low Passage"); break;
      case 2: ch.improveAttribute("intelligence", 1); break;
      case 3: ch.improveAttribute("education", 2); break;
      case 4: ch.doGunBenefit(); break;
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
          case 5: ch.improveAttribute("education", 1); break;
          default: ch.addSkill("Brawling");
        }
        break;
      case 2:
        switch (roll(1)) {
          case 1: ch.addSkill("ATV"); break;
          case 2: ch.addSkill("Air/Raft"); break;
          case 3: ch.addSkill(cascadeGun(ch)); break;
          case 4: ch.addSkill("Fwd Obsvr"); break;
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
