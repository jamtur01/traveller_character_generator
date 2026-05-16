import type { ServiceDef } from "../types";
import { roll } from "../random";
import { cascadeBlade, cascadeGun } from "../cascades";
import { commissionCheck, promotionCheck, survivalCheck } from "./common";

export const navy: ServiceDef = {
  serviceName: "Navy",
  memberName: "Navy",
  enlistmentThrow: 8,
  enlistmentDM: (a) => (a.intelligence >= 8 ? 1 : 0) + (a.education >= 9 ? 2 : 0),
  survivalThrow: 5,
  commissionThrow: 10,
  promotionThrow: 8,
  reenlistThrow: 6,
  ranks: {
    0: "", 1: "Ensign", 2: "Lieutenant", 3: "Lt Cmdr",
    4: "Commander", 5: "Captain", 6: "Admiral",
  },
  getServiceSkills: () => [],
  checkSurvival: (ch) => survivalCheck(ch, 5, ch.attributes.intelligence >= 7 ? 2 : 0),
  checkCommission: (ch) => commissionCheck(ch, 10, ch.attributes.social >= 9 ? 1 : 0),
  checkPromotion: (ch) => promotionCheck(ch, 8, ch.attributes.education >= 8 ? 1 : 0),
  doPromotion: (ch) => {
    if (ch.rank === 5 || ch.rank === 6) ch.improveAttribute("social", 1);
  },
  musterCash: { 1: 1000, 2: 5000, 3: 5000, 4: 10000, 5: 20000, 6: 50000, 7: 50000 },
  musterBenefits: (ch, dm) => {
    switch (roll(1) + dm) {
      case 1: ch.addBenefit("Low Passage"); break;
      case 2: ch.improveAttribute("intelligence", 1); break;
      case 3: ch.improveAttribute("education", 2); break;
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
          case 4: ch.improveAttribute("intelligence", 1); break;
          case 5: ch.improveAttribute("education", 1); break;
          default: ch.improveAttribute("social", 1);
        }
        break;
      case 2:
        switch (roll(1)) {
          case 1: ch.addSkill("Ship's Boat"); break;
          case 2: ch.addSkill("Vacc Suit"); break;
          case 3: ch.addSkill("Fwd Obsvr"); break;
          case 4: ch.addSkill("Gunnery"); break;
          case 5: ch.addSkill(cascadeBlade(ch)); break;
          default: ch.addSkill(cascadeGun(ch));
        }
        break;
      case 3:
        switch (roll(1)) {
          case 1: ch.addSkill("Vacc Suit"); break;
          case 2: ch.addSkill("Mechanical"); break;
          case 3: ch.addSkill("Electronic"); break;
          case 4: ch.addSkill("Engineering"); break;
          case 5: ch.addSkill("Gunnery"); break;
          default: ch.addSkill("Jack-o-T");
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
