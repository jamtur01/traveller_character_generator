// Mongoose Traveller 2e edition hooks. The Mongoose flow is driven by the
// `mongoose` ChargenModel (engine/mongoose/*), not by the basic-lifecycle
// STEP_REGISTRY, so there are no ad-hoc promotion/lifecycle hooks to register —
// every mechanic reads from data.mongoose. The empty object keeps the edition
// registration uniform with the other editions.

import type { EditionHooks } from "@/lib/traveller/editions/types";

export const mongooseHooks: EditionHooks = {};
