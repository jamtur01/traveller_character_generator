import type { ServiceDef } from "../types";
import { roll } from "../random";
import { cascadeBlade, cascadeBow, cascadeGun } from "../cascades";
import { commissionCheck, promotionCheck, survivalCheck } from "./common";

export const barbarians: ServiceDef = {
  serviceName: "Barbarian",
  memberName: "Barbarian",
  enlistmentThrow: 5,
  enlistmentDM: (a) => (a.endurance >= 9 ? 1 : 0) + (a.strength >= 10 ? 2 : 0),
  survivalThrow: 6,
  commissionThrow: 6,
  promotionThrow: 9,
  reenlistThrow: 6,
  ranks: {
    // CotI: only rank 2 (Warrior) and rank 5 (Chief) carry a title.
    0: "", 1: "", 2: "Warrior", 3: "", 4: "", 5: "Chief", 6: "",
  },
  getServiceSkills: () => ["Sword"],
  checkSurvival: (ch) => survivalCheck(ch, 6, ch.attributes.strength >= 8 ? 2 : 0),
  checkCommission: (ch) => commissionCheck(ch, 6, ch.attributes.strength >= 10 ? 1 : 0),
  checkPromotion: (ch) => promotionCheck(ch, 9, ch.attributes.intelligence >= 6 ? 1 : 0),
  doPromotion: (ch) => {
    if (ch.rank === 2) ch.addSkill(cascadeBlade(ch));
    else if (ch.rank === 5) ch.addSkill("Leader");
  },
  musterCash: { 1: 0, 2: 0, 3: 1000, 4: 2000, 5: 3000, 6: 4000, 7: 5000 },
  musterBenefits: (ch, dm) => {
    switch (roll(1) + dm) {
      case 1: ch.addBenefit("Low Passage"); break;
      case 2: ch.doBladeBenefit(); break;
      case 3: ch.doBladeBenefit(); break;
      case 4: ch.doBladeBenefit(); break;
      case 5: break;
      case 6: ch.addBenefit("High Passage"); break;
      default: ch.addBenefit("High Passage");
    }
  },
  acquireSkill: (ch) => {
    switch (ch.whichSkillTable()) {
      case 1:
        switch (roll(1)) {
          case 1: ch.improveAttribute("strength", 1); break;
          case 2: ch.improveAttribute("strength", 2); break;
          case 3: ch.improveAttribute("strength", 1); break;
          case 4: ch.addSkill("Carousing"); break;
          case 5: ch.improveAttribute("dexterity", 1); break;
          default: ch.improveAttribute("endurance", 1);
        }
        break;
      case 2:
        switch (roll(1)) {
          case 1: ch.addSkill("Brawling"); break;
          case 2: ch.addSkill(cascadeBlade(ch)); break;
          case 3: ch.addSkill(cascadeBlade(ch)); break;
          case 4: ch.addSkill(cascadeBow(ch)); break;
          case 5: ch.addSkill(cascadeBow(ch)); break;
          default: ch.addSkill(cascadeGun(ch));
        }
        break;
      case 3:
        switch (roll(1)) {
          case 1: ch.addSkill(cascadeBlade(ch)); break;
          case 2: ch.addSkill("Mechanical"); break;
          case 3: ch.addSkill("Survival"); break;
          case 4: ch.addSkill("Recon"); break;
          case 5: ch.addSkill("Streetwise"); break;
          default: ch.addSkill(cascadeBow(ch));
        }
        break;
      case 4:
        switch (roll(1)) {
          case 1: ch.addSkill("Medical"); break;
          case 2: ch.addSkill("Interrogation"); break;
          case 3: ch.addSkill("Tactics"); break;
          case 4: ch.addSkill("Leader"); break;
          case 5: ch.addSkill("Instruction"); break;
          default: ch.addSkill("Jack-o-T");
        }
        break;
    }
  },
};
