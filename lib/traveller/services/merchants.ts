import type { ServiceDef } from "../types";
import { roll } from "../random";
import { cascadeBlade, cascadeGun, cascadeVehicle } from "../cascades";
import { commissionCheck, promotionCheck, survivalCheck } from "./common";

export const merchants: ServiceDef = {
  serviceName: "Merchants",
  memberName: "Merchant",
  enlistmentThrow: 7,
  enlistmentDM: (a) => (a.strength >= 7 ? 1 : 0) + (a.intelligence >= 6 ? 2 : 0),
  survivalThrow: 5,
  commissionThrow: 4,
  promotionThrow: 10,
  reenlistThrow: 4,
  ranks: {
    0: "", 1: "4th Officer", 2: "3rd Officer", 3: "2nd Officer",
    4: "1st Officer", 5: "Captain", 6: "",
  },
  getServiceSkills: () => [],
  checkSurvival: (ch) => survivalCheck(ch, 5, ch.attributes.intelligence >= 7 ? 2 : 0),
  checkCommission: (ch) => commissionCheck(ch, 4, ch.attributes.intelligence >= 6 ? 1 : 0),
  checkPromotion: (ch) => promotionCheck(ch, 10, ch.attributes.intelligence >= 9 ? 1 : 0),
  doPromotion: (ch) => {
    if (ch.rank === 4) ch.addSkill("Pilot");
  },
  musterCash: { 1: 1000, 2: 5000, 3: 10000, 4: 20000, 5: 20000, 6: 40000, 7: 40000 },
  musterBenefits: (ch, dm) => {
    switch (roll(1) + dm) {
      case 1: ch.addBenefit("Low Passage"); break;
      case 2: ch.improveAttribute("intelligence", 1); break;
      case 3: ch.improveAttribute("education", 1); break;
      case 4: ch.doGunBenefit(); break;
      case 5: ch.doBladeBenefit(); break;
      case 6: ch.addBenefit("Low Passage"); break;
      default:
        if (ch.benefits.indexOf("Free Trader") > -1) {
          ch.mortgages += 1;
          if (ch.mortgage > 0) {
            ch.mortgage -= 10;
            ch.verboseHistory("10 years of mortgage paid off");
          } else {
            ch.debugHistory("No benefit");
          }
        } else {
          ch.addBenefit("Free Trader");
          ch.ship = true;
        }
    }
  },
  acquireSkill: (ch) => {
    switch (ch.whichSkillTable()) {
      case 1:
        switch (roll(1)) {
          case 1: ch.improveAttribute("strength", 1); break;
          case 2: ch.improveAttribute("dexterity", 1); break;
          case 3: ch.improveAttribute("endurance", 1); break;
          case 4: ch.improveAttribute("strength", 1); break;
          case 5: ch.addSkill(cascadeBlade(ch)); break;
          default: ch.addSkill("Bribery");
        }
        break;
      case 2:
        switch (roll(1)) {
          case 1: ch.addSkill(cascadeVehicle(ch)); break;
          case 2: ch.addSkill("Vacc Suit"); break;
          case 3: ch.addSkill("Jack-o-T"); break;
          case 4: ch.addSkill("Steward"); break;
          case 5: ch.addSkill("Electronic"); break;
          default: ch.addSkill(cascadeGun(ch));
        }
        break;
      case 3:
        switch (roll(1)) {
          case 1: ch.addSkill("Streetwise"); break;
          case 2: ch.addSkill("Mechanical"); break;
          case 3: ch.addSkill("Electronic"); break;
          case 4: ch.addSkill("Navigation"); break;
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
          default: ch.addSkill("Admin");
        }
        break;
    }
  },
};
