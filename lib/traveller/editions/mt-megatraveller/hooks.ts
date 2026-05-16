// MegaTraveller edition hooks. ACG pathway factories are registered here;
// the runner looks them up by name rather than importing them statically.

import type { EditionHooks } from "../types";
import { getMercenaryPathway } from "../../engine/acg/pathways/mercenary";
import { getNavyPathway } from "../../engine/acg/pathways/navy";
import { getScoutPathway } from "../../engine/acg/pathways/scout";
import { getMerchantPrincePathway } from "../../engine/acg/pathways/merchantPrince";

export const mtMegatravellerHooks: EditionHooks = {
  acgPathways: {
    mercenary: getMercenaryPathway,
    navy: getNavyPathway,
    scout: getScoutPathway,
    merchantPrince: getMerchantPrincePathway,
  },
};
