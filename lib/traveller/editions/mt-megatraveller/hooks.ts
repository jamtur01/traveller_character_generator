// MegaTraveller edition hooks. The data file is extracted but the engine
// does not yet handle MT-specific mechanics (Special Duty roll, skillsPerTerm
// override, term-1 bonus skill, expanded cascade vocabulary, term-3 Belter
// Zero-G auto-skill, mandatory reenlist on exact 12, double-bonus rolls
// on commission/promotion/special-duty overshoot). When you wire those up,
// the corresponding named hooks live here.

import type { EditionHooks } from "../types";

export const mtMegatravellerHooks: EditionHooks = {};
