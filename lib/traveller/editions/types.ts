// Types describing the JSON canonical-data shape and the runtime edition
// object the engine consumes. One JSON file per edition lives under
// data/editions/; this module models that shape.

import type { Character } from "../character";
import type { ServiceKey } from "../types";

export interface EditionMeta {
  id: string;
  name: string;
  displayName: string;
  rulebooks: string[];
  year?: number;
  /**
   * "active" = engine fully supports this edition.
   * "data-only" = canonical JSON is extracted but the engine doesn't yet
   * implement the edition's mechanics; useful for previewing the data and
   * marking the UI picker entry as disabled.
   */
  status?: "active" | "data-only";
  /**
   * Whether the interactive choice flow (pause for cascade / weapon-type
   * picks) makes sense for this edition. CT chargen is rolled procedurally
   * per the rulebook — the only meaningful player choice during a term is
   * which skill table to roll on, which the existing UI already supports.
   * Editions like MT that add more decision points opt in by setting true.
   */
  supportsInteractive?: boolean;
}

export interface DMRule {
  /** Numeric DM, or a literal token interpreted by the DM evaluator. */
  modifier: number | "termNumber";
  attribute?: string;
  min?: number;
  max?: number;
  description?: string;
}

export interface CheckData {
  target: number | null;
  dm?: DMRule[];
  label?: string;
  inverseToLeave?: boolean;
  special?: string;
}

export interface AutoSkillEntry {
  /** "service" = on enlistment; "rank" with rank=N = when rank reaches N. */
  trigger: "service" | "rank";
  rank?: number;
  /** A skill name (literal or cascade label) granted at level. */
  skill?: string;
  level?: number;
  /** Or an attribute change in cell syntax ("+1 Social", "+2 Educ"). */
  effect?: string;
}

export interface ServiceData {
  source: "ttb" | "coti";
  bookPage: number;
  displayName: string;
  startAge: number;
  draft: number | null;
  checks: {
    enlistment: CheckData;
    survival: CheckData;
    position: CheckData | null;
    promotion: CheckData | null;
    reenlistment: CheckData;
  };
  ranks: (string | null)[];
  automaticSkills: AutoSkillEntry[];
  /** Named-hook references for service-specific quirks not expressible in data. */
  hooks?: {
    doPromotion?: string;
  };
  skillTables: {
    personalDevelopment: (string | null)[];
    serviceSkills: (string | null)[];
    advancedEducation: (string | null)[];
    advancedEducation8Plus: (string | null)[];
  };
  musterOut: {
    benefits: (string | null)[];
    cash: (number | null)[];
  };
  notes?: string[];
}

export interface BenefitDetail {
  shipType?: string;
  firstReceiptMortgageYears?: number;
  repeatReducesMortgageYears?: number;
  repeat?: string;
  cashValueCredits?: number;
  resalePercent?: number;
  revivalSave?: string;
  description?: string;
  valueCredits?: number;
  typicalValueCredits?: number;
  valuableValueRoll?: string;
  choices?: string | string[];
  repeatMayBecomeSkill?: boolean;
  name?: string;
  basis?: string;
}

export interface LifecycleStep {
  /** Step id — must match a key in the engine's step registry. */
  id: string;
  /** Step-specific config, passed to the step function as ctx.config. */
  config?: Record<string, unknown>;
}

export interface LifecycleSpec {
  /** Ordered sequence of steps run once per term in basic chargen. */
  terms: LifecycleStep[];
  /** Optional sequence of steps run per term for ACG chargen. When the
   *  active edition has Advanced Character Generation and the character
   *  set useAcg=true, the runner uses this sequence instead of `terms`. */
  acgTerms?: LifecycleStep[];
}

export interface CanonData {
  schemaVersion: number;
  edition: EditionMeta;
  services: Record<ServiceKey, ServiceData>;
  benefitDetails: Record<string, BenefitDetail>;
  lifecycle?: LifecycleSpec & Record<string, unknown>;
  /** Engine-consumable rules. Each block is opt-in: the engine falls back
   *  to its defaults when a block is missing. */
  rules?: Record<string, unknown>;
  /** Aging table — rows keyed by end-of-term number. */
  aging?: Record<string, unknown>;
  /** MegaTraveller Advanced Character Generation data. Editions without
   *  an advanced chargen system omit this block; editions that have it
   *  declare it under this key. The engine exposes `editionHasAcg(id)` /
   *  `listAcgPathways(id)` over this block. */
  advancedCharacterGeneration?: AcgData;
}

export interface AcgData {
  source?: string;
  coverage?: Record<string, number[]>;
  common: Record<string, unknown>;
  /** Pathways are named entries — MT has mercenary, navy, scout,
   *  merchantPrince. Each is a self-contained chargen branch. */
  [pathway: string]: unknown;
}

export interface AcgPathway {
  sourcePrintedPages?: number[];
  checklist?: unknown;
  enlistment?: unknown;
  ranks?: { enlisted?: unknown[]; officer?: unknown[] };
  reenlistment?: unknown;
  [k: string]: unknown;
}

/**
 * Named-hook signatures. Each edition can supply implementations under
 * keys referenced from the JSON. Hooks are the escape hatch for genuinely
 * ad-hoc per-service mechanics that don't fit the data schema.
 */
export interface EditionHooks {
  /**
   * Service-specific post-promotion behavior. Runs after the rank is
   * incremented and after automaticSkills with trigger="rank" have fired.
   */
  doPromotion?: Record<string, (ch: Character) => void>;
}

export interface Edition {
  meta: EditionMeta;
  data: CanonData;
  hooks: EditionHooks;
}
