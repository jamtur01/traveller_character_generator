import type { ServiceDef } from "../types";
import { roll } from "../random";
import { cascadeBlade } from "../cascades";
import { survivalCheck } from "./common";

export const doctors: ServiceDef = {
  serviceName: "Doctors",
  memberName: "Doctor",
  enlistmentThrow: 9,
  enlistmentDM: (a) => (a.intelligence >= 8 ? 1 : 0) + (a.dexterity >= 9 ? 2 : 0),
  survivalThrow: 3,
  reenlistThrow: 4,
  ranks: { 0: "", 1: "", 2: "", 3: "", 4: "", 5: "", 6: "" },
  getServiceSkills: () => ["Medical"],
  checkSurvival: (ch) => survivalCheck(ch, 3, ch.attributes.intelligence >= 8 ? 2 : 0),
  checkCommission: () => false,
  checkPromotion: () => false,
  doPromotion: () => {},
  musterCash: { 1: 20000, 2: 20000, 3: 20000, 4: 30000, 5: 40000, 6: 60000, 7: 100000 },
  musterBenefits: (ch, dm) => {
    switch (roll(1) + dm) {
      case 1: ch.addBenefit("Low Passage"); break;
      case 2: ch.improveAttribute("education", 1); break;
      case 3: ch.improveAttribute("education", 1); break;
      case 4: ch.doWeaponBenefit(); break;
      case 5:
        if (ch.benefits.indexOf("Instruments") > -1) {
          ch.debugHistory("No benefit");
          break;
        }
        ch.addBenefit("Instruments");
        break;
      case 6: ch.addBenefit("Mid Passage"); break;
      // Row 7 (rank-5/6 DM) is blank per CotI p. 6, and Doctors have no ranks
      // so this branch is unreachable in practice — explicit no-op for audit.
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
          case 4: ch.improveAttribute("intelligence", 1); break;
          case 5: ch.improveAttribute("education", 1); break;
          default: ch.improveAttribute("social", 1);
        }
        break;
      case 2:
        switch (roll(1)) {
          case 1: ch.improveAttribute("dexterity", 1); break;
          case 2: ch.addSkill("Electronic"); break;
          case 3: ch.addSkill("Medical"); break;
          case 4: ch.addSkill("Streetwise"); break;
          case 5: ch.addSkill("Medical"); break;
          default: ch.addSkill(cascadeBlade(ch));
        }
        break;
      case 3:
        switch (roll(1)) {
          case 1: ch.addSkill("Medical"); break;
          case 2: ch.addSkill("Medical"); break;
          case 3: ch.addSkill("Mechanical"); break;
          case 4: ch.addSkill("Electronic"); break;
          case 5: ch.addSkill("Computer"); break;
          default: ch.addSkill("Admin");
        }
        break;
      case 4:
        switch (roll(1)) {
          case 1: ch.addSkill("Medical"); break;
          case 2: ch.addSkill("Medical"); break;
          case 3: ch.addSkill("Admin"); break;
          case 4: ch.addSkill("Computer"); break;
          case 5: ch.improveAttribute("intelligence", 1); break;
          default: ch.improveAttribute("education", 1);
        }
        break;
    }
  },
};
