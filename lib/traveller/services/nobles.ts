import type { ServiceDef } from "../types";
import { roll } from "../random";
import { cascadeBlade, cascadeGun, cascadeVehicle } from "../cascades";
import { commissionCheck, promotionCheck, survivalCheck } from "./common";

export const nobles: ServiceDef = {
  serviceName: "Noble",
  memberName: "Noble",
  // The auto-enroll path in Character.doEnlistment handles entry for Soc 10+;
  // these throw/DM fields exist for completeness and audit.
  enlistmentThrow: 3,
  enlistmentDM: (a) => (a.social <= 9 ? -12 : 0) + (a.social >= 10 ? 12 : 0),
  survivalThrow: 3,
  commissionThrow: 5,
  promotionThrow: 12,
  reenlistThrow: 4,
  ranks: {
    0: "", 1: "B Knight", 2: "C Baron", 3: "D Marquis",
    4: "E Count", 5: "F Duke", 6: "",
  },
  getServiceSkills: () => [],
  checkSurvival: (ch) => survivalCheck(ch, 3, 0),
  checkCommission: (ch) => {
    const ok = commissionCheck(ch, 5, ch.attributes.education >= 9 ? 1 : 0);
    // TTB p. 17 caps player-character attributes at 15. improveAttribute
    // enforces the cap; the explicit guard avoids a no-op log entry.
    if (ok && ch.attributes.social < 15) ch.improveAttribute("social", 1);
    return ok;
  },
  checkPromotion: (ch) => {
    const ok = promotionCheck(ch, 12, ch.attributes.intelligence >= 10 ? 1 : 0);
    if (ok && ch.attributes.social < 15) ch.improveAttribute("social", 1);
    return ok;
  },
  doPromotion: (ch) => {
    const rankSocial = ch.rank + 10;
    if (ch.attributes.social < rankSocial) ch.attributes.social = rankSocial;
  },
  musterCash: { 1: 10000, 2: 50000, 3: 50000, 4: 100000, 5: 100000, 6: 100000, 7: 200000 },
  musterBenefits: (ch, dm) => {
    switch (roll(1) + dm) {
      case 1: ch.addBenefit("High Passage"); break;
      case 2: ch.addBenefit("High Passage"); break;
      case 3: ch.doGunBenefit(); break;
      case 4: ch.doBladeBenefit(); break;
      case 5:
        if (ch.benefits.indexOf("Travellers' Aid Society") > -1) break;
        ch.addBenefit("Travellers' Aid Society");
        ch.TAS = true;
        break;
      case 6:
        if (ch.benefits.indexOf("Yacht") > -1) {
          ch.debugHistory("No benefit");
          break;
        }
        ch.addBenefit("Yacht");
        ch.ship = true;
        break;
      // Roll 7 (rank 5/6 DM) is blank per CotI p. 13 — explicit no-op.
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
          case 5: ch.addSkill("Carousing"); break;
          default: ch.addSkill("Brawling");
        }
        break;
      case 2:
        switch (roll(1)) {
          case 1: ch.addSkill(cascadeGun(ch)); break;
          case 2: ch.addSkill(cascadeBlade(ch)); break;
          case 3: ch.addSkill("Hunting"); break;
          case 4: ch.addSkill(cascadeVehicle(ch)); break;
          case 5: ch.addSkill("Bribery"); break;
          default: ch.improveAttribute("dexterity", 1);
        }
        break;
      case 3:
        switch (roll(1)) {
          case 1: ch.addSkill("Pilot"); break;
          case 2: ch.addSkill("Ship's Boat"); break;
          case 3: ch.addSkill(cascadeVehicle(ch)); break;
          case 4: ch.addSkill("Navigation"); break;
          case 5: ch.addSkill("Engineering"); break;
          default: ch.addSkill("Leader");
        }
        break;
      case 4:
        switch (roll(1)) {
          case 1: ch.addSkill("Medical"); break;
          case 2: ch.addSkill("Computer"); break;
          case 3: ch.addSkill("Admin"); break;
          case 4: ch.addSkill("Liaison"); break;
          case 5: ch.addSkill("Leader"); break;
          default: ch.addSkill("Jack-o-T");
        }
        break;
    }
  },
};
