import type { ServiceDef } from "../types";
import { roll } from "../random";
import { cascadeBlade, cascadeGun } from "../cascades";
import { commissionCheck, promotionCheck, survivalCheck } from "./common";

export const pirates: ServiceDef = {
  serviceName: "Pirates",
  memberName: "Pirate",
  enlistmentThrow: 7,
  enlistmentDM: (a) => (a.social <= 7 ? 1 : 0) + (a.endurance >= 9 ? 2 : 0),
  survivalThrow: 6,
  commissionThrow: 9,
  promotionThrow: 8,
  reenlistThrow: 7,
  ranks: {
    0: "", 1: "Henchman", 2: "Corporal", 3: "Sergeant",
    4: "Lieutenant", 5: "Leader", 6: "",
  },
  getServiceSkills: () => ["Brawling"],
  checkSurvival: (ch) => survivalCheck(ch, 6, ch.attributes.intelligence >= 8 ? 2 : 0),
  checkCommission: (ch) => commissionCheck(ch, 9, ch.attributes.strength >= 10 ? 1 : 0),
  checkPromotion: (ch) => promotionCheck(ch, 8, ch.attributes.intelligence >= 9 ? 1 : 0),
  doPromotion: (ch) => {
    if (ch.rank === 4) ch.addSkill("Pilot");
  },
  musterCash: { 1: 0, 2: 0, 3: 1000, 4: 10000, 5: 50000, 6: 50000, 7: 50000 },
  musterBenefits: (ch, dm) => {
    switch (roll(1) + dm) {
      case 1: ch.addBenefit("Low Passage"); break;
      case 2: ch.improveAttribute("intelligence", 1); break;
      case 3: ch.doWeaponBenefit(); break;
      case 4: break;
      case 5: ch.improveAttribute("social", -1); break;
      case 6: ch.addBenefit("Mid Passage"); break;
      default:
        if (ch.benefits.indexOf("Corsair") > -1) {
          ch.debugHistory("No benefit");
          break;
        }
        ch.addBenefit("Corsair");
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
          case 4: ch.addSkill("Gambling"); break;
          case 5: ch.addSkill("Brawling"); break;
          default: ch.addSkill(cascadeBlade(ch));
        }
        break;
      case 2:
        switch (roll(1)) {
          case 1: ch.addSkill(cascadeBlade(ch)); break;
          case 2: ch.addSkill("Vacc Suit"); break;
          case 3: ch.addSkill(cascadeGun(ch)); break;
          case 4: ch.addSkill("Gunnery"); break;
          case 5: ch.addSkill("Zero-G Cbt"); break;
          default: ch.addSkill(cascadeGun(ch));
        }
        break;
      case 3:
        switch (roll(1)) {
          case 1: ch.addSkill("Streetwise"); break;
          case 2: ch.addSkill("Gunnery"); break;
          case 3: ch.addSkill("Engineering"); break;
          case 4: ch.addSkill("Ship Tactic"); break;
          case 5: ch.addSkill("Tactics"); break;
          default: ch.addSkill("Mechanical");
        }
        break;
      case 4:
        switch (roll(1)) {
          case 1: ch.addSkill("Navigation"); break;
          case 2: ch.addSkill("Pilot"); break;
          case 3: ch.addSkill("Forgery"); break;
          case 4: ch.addSkill("Computer"); break;
          case 5: ch.addSkill("Leader"); break;
          default: ch.addSkill("Electronic");
        }
        break;
    }
  },
};
