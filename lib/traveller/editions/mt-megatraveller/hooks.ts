// MegaTraveller edition hooks. ACG pathway factories are registered here;
// the runner looks them up by name rather than importing them statically.

import type { EditionHooks } from "@/lib/traveller/editions/types";
import { getMercenaryPathway } from "@/lib/traveller/engine/acg/pathways/mercenary";
import { getNavyPathway } from "@/lib/traveller/engine/acg/pathways/navy";
import { getScoutPathway } from "@/lib/traveller/engine/acg/pathways/scout";
import { getMerchantPrincePathway } from "@/lib/traveller/engine/acg/pathways/merchantPrince";

export const mtMegatravellerHooks: EditionHooks = {
  acgPathways: {
    mercenary: getMercenaryPathway,
    navy: getNavyPathway,
    scout: getScoutPathway,
    merchantPrince: getMerchantPrincePathway,
  },
};
