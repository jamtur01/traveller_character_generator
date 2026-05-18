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
  /** "service" = on enlistment; "rank" with rank=N = when rank reaches N;
   *  "term" with term=N = at the start of term N (MT Belter Zero-G is the
   *  canonical example). */
  trigger: "service" | "rank" | "term";
  rank?: number;
  term?: number;
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
    /** MT Special Duty check (PM p. 17 — fifth per-term throw that
     *  grants a skill point on success, double on overshoot). CT
     *  services omit it. */
    specialDuty?: { target: number };
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
  /** Ordered sequence of steps run once per term in basic chargen. ACG
   *  chargen does NOT use this sequence — it runs the dedicated per-year
   *  assignment cycle via runAcgYear in engine/acg/runner.ts. */
  terms: LifecycleStep[];
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
  /** Cascade-skill pools (Blade Combat → [Cutlass, ...], etc.). MT
   *  declares many; CT has none and omits the field. */
  cascadeSkills?: Record<string, readonly string[]>;
  /** Abbreviated → full attribute key map ("Intel" → "intelligence"). */
  attributeAbbreviations?: Record<string, string>;
  /** Printed cell-label → engine skill name aliases (typo / abbreviation
   *  normalization). */
  skillLabelRenames?: Record<string, string>;
  /** PM Includes-skills declarations (granting multiple constituent
   *  skills from a single cell). */
  includesSkills?: Record<string, unknown>;
  /** Homeworld generation tables — UWP traits, default skills, career
   *  availability. MT only; CT omits. Exact shape declared in
   *  engine/homeworld.ts (HomeworldData) and re-exported via a
   *  ref-import to avoid circular type-only dependencies. */
  homeworld?: import("../engine/homeworld").HomeworldData;
  /** MegaTraveller Advanced Character Generation data. Editions without
   *  an advanced chargen system omit this block; editions that have it
   *  declare it under this key. The engine exposes `editionHasAcg(id)` /
   *  `listAcgPathways(id)` over this block. */
  advancedCharacterGeneration?: AcgData;
}

export interface AcgData {
  source?: string;
  coverage?: Record<string, number[]>;
  common: AcgCommonData;
  /** Pathways are named entries — MT has mercenary, navy, scout,
   *  merchantPrince. Each is a self-contained chargen branch. The
   *  pathway-specific shape lives in engine/acg/pathways/*. */
  mercenary?: AcgPathwayData;
  navy?: AcgPathwayData;
  scout?: AcgPathwayData;
  merchantPrince?: AcgPathwayData;
  homeworld?: { techCodeOrder?: string[] };
  [pathway: string]: unknown;
}

/** Common ACG block (shared rules across pathways). */
export interface AcgCommonData {
  preCareerOptions?: Record<string, unknown>;
  browniePoints?: { awards?: unknown[] };
  decorationTiers?: { tiers?: Array<Record<string, unknown>> };
  [k: string]: unknown;
}

/** Per-pathway ACG data. The union of mercenary/navy/scout/merchant
 *  sub-fields — pathway-specific fields are optional so each pathway's
 *  consumers can read what they need without a separate cast. */
export interface AcgPathwayData {
  sourcePrintedPages?: number[];
  checklist?: unknown;
  enlistment?: unknown;
  ranks?: { enlisted?: unknown[]; officer?: unknown[] };
  reenlistment?: unknown;
  ocsAdvancement?: { ageLimit?: number; [k: string]: unknown };
  schoolMeta?: Record<string, unknown>;
  specialRules?: Record<string, unknown>;
  specialAssignmentRules?: Record<string, unknown>;
  combatAssignments?: string[];
  assignmentColumnMap?: Record<string, string>;
  freeTraderAssignmentFlags?: Record<string, unknown>;
  skillTables?: Record<string, unknown>;
  skillColumnPolicy?: unknown;
  decorationTiers?: { tiers?: Array<Record<string, unknown>> };
  [k: string]: unknown;
}

/** Legacy alias for AcgPathwayData. */
export type AcgPathway = AcgPathwayData;

/**
 * ACG pathway implementation supplied by the edition's hooks. The runner
 * dispatches per-year / per-term work through these callbacks. Editions
 * that don't have ACG omit the block entirely.
 */
// Enlist signatures vary across pathways (mercenary takes service+combatArm;
// navy takes fleet; merchantPrince takes lineType; scout takes nothing). The
// type uses an `any`-typed rest parameter so concrete factories — which have
// well-typed signatures locally — can be assigned without a cast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AcgEnlist = (ch: Character, ...args: any[]) => void;

export interface AcgPathwayImpl {
  pathway: string;
  enlist: AcgEnlist;
  initialTraining?: (ch: Character) => void;
  commandDuty?: (ch: Character) => void;
  rollAssignment: (ch: Character) => string;
  resolveAssignment: (ch: Character, assignment: string) => void;
  specialAssignment?: (ch: Character) => void;
  retention?: (ch: Character, assignment: string) => void;
  reenlist: (ch: Character) => boolean;
  startOfTerm?: (ch: Character) => void;
  endOfTerm?: (ch: Character) => void;
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
  /**
   * ACG pathway factories, keyed by pathway name (matching the JSON key
   * under advancedCharacterGeneration.<name>). Required when the edition's
   * JSON declares pathways. Adding a new pathway = drop a JSON block and
   * register a factory here.
   */
  acgPathways?: Record<string, () => AcgPathwayImpl>;
}

export interface Edition {
  meta: EditionMeta;
  data: CanonData;
  hooks: EditionHooks;
  /** Schema-validated typed view of `data.rules`. Engine code should
   *  prefer this over `data.rules as { ... }`. */
  rules: import("./schema").RulesData;
}
