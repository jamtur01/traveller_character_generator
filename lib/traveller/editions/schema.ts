// Runtime validation for edition JSON. The engine reads heavily-typed
// data out of `edition.data.*`, and call sites historically cast via
// `as { ... }`, which silently accepted typos and shape drift. This
// module validates the load-bearing blocks once at edition load (in
// `buildEdition`) and throws on shape errors.
//
// Coverage:
//   - rules (parseRules) — typed view returned for engine consumption
//   - services / cascadeSkills / aging / includesSkills /
//     attributeAbbreviations / skillLabelRenames — parseCanonData
//
// Out of scope:
//   - advancedCharacterGeneration block — validated separately at
//     first getEdition() call via validateEditionAcgConfigs.
//   - pdfExtraction / extractionNotes / sources / title / weapons —
//     provenance metadata not consumed by the engine.
//   - homeworld — declared on its own typed interface in
//     engine/homeworld.ts; we accept any object here.
//
// Note on z.looseObject: zod 4 deprecated `.passthrough()`. The
// replacement is `z.looseObject({...})`, which keeps unknown keys on
// the parsed value (vs. `z.object` which strips them). We use loose
// objects wherever the JSON includes `$rule` / `$comment` citation
// keys or vendor-extension fields the schema doesn't yet model.

import { z } from "zod";

const RankBandSchema = z.object({
  ranks: z.array(z.number()),
  additionalRolls: z.number(),
});

const RankExtraRollSchema = z.object({
  rankMin: z.number(),
  rankMax: z.number(),
  additionalRolls: z.number(),
});

export const RulesSchema = z.looseObject({
  // Skill-cap (PM p. 39 Int+Edu cap). Presence indicates the edition
  // enforces a per-character skill-level total cap.
  skillCap: z.unknown().optional(),
  // Attribute hard limits + per-edition socialMin override.
  attributeCaps: z.object({
    max: z.number().optional(),
    min: z.number().optional(),
    socialMin: z.number().optional(),
  }).optional(),
  // Reenlistment behavior.
  reenlistment: z.object({
    mandatoryOnExactRoll: z.number().optional(),
    mandatoryRetireAfterTerm: z.number().optional(),
    mandatoryRoll: z.number().optional(),
    voluntaryAnyTerms: z.boolean().optional(),
    retireAfterCompletedTerm: z.number().optional(),
    mandatoryRollNote: z.string().optional(),
  }).optional(),
  // Retirement / pension.
  retirement: z.object({
    eligibleAfterCompletedTerm: z.number().optional(),
    basePensionCredits: z.number().optional(),
    pensionCreditsPerTerm: z.number().optional(),
    excludedServices: z.array(z.string()).optional(),
    anagathicTermsExcluded: z.boolean().optional(),
  }).optional(),
  // Muster-out roll counts.
  musterOutRolls: z.object({
    perTerm: z.number().optional(),
    rankBands: z.array(RankBandSchema).optional(),
    rankExtraRolls: z.array(RankExtraRollSchema).optional(),
  }).optional(),
  // Disability (MT F2/F3 rule).
  disability: z.object({
    physicalAttributes: z.array(z.string()).optional(),
    atAgeLine: z.number().optional(),
    physicalAttributeAtMost: z.number().optional(),
    sumPhysicalAttributesAtMost: z.number().optional(),
  }).optional(),
  // Noble titles by social-standing tier (keys "10", "11", "12", "13",
  // "14", "15"; each maps to { male?, female? } title strings). The
  // JSON also includes `$rule` / `$comment` citation keys with string
  // values, hence the union with z.string().
  nobleTitles: z.record(
    z.string(),
    z.union([
      z.object({
        male: z.string().optional(),
        female: z.string().optional(),
      }),
      z.string(),
    ]),
  ).optional(),
  // Aging crisis (MT p. 47).
  agingCrisis: z.object({
    whenAttributeReducedTo: z.number().optional(),
    save: z.number().optional(),
  }).optional(),
  // Survival-failure consequence. CT defaults to death; MT to shortTerm.
  survival: z.object({
    onFailure: z.enum(["death", "musterOut", "shortTerm"]).optional(),
    shortTermYears: z.number().optional(),
    fullTermYears: z.number().optional(),
    shortTermDoesNotCountForMusterBenefits: z.boolean().optional(),
    skipCommissionPromotionInShortTerm: z.boolean().optional(),
    specialDutyAndSkillsStillRoll: z.boolean().optional(),
    optionalDeathRule: z.string().optional(),
  }).optional(),
  // Skill-eligibility table-row counts (CT/MT divergence).
  skillEligibility: z.object({
    initialTerm: z.number().optional(),
    subsequentTerm: z.number().optional(),
    onPositionOrCommission: z.number().optional(),
    onPromotion: z.number().optional(),
    onSpecialDuty: z.number().optional(),
    doubleSkillMargin: z.number().optional(),
    perTermExceptions: z.record(z.string(), z.number()).optional(),
  }).optional(),
  // Muster DMs (per-rank, retired bonus).
  musterDm: z.looseObject({
    cashTableDm: z.array(z.unknown()).optional(),
    benefitTableDm: z.array(z.unknown()).optional(),
    maxCashTableRolls: z.number().optional(),
  }).optional(),
  // Marine Tradition (F5 — forced Large Blade for Marines).
  marineTradition: z.object({
    appliesToServices: z.array(z.string()).optional(),
    appliesToCascade: z.string().optional(),
    forcedSkill: z.string().optional(),
    savingThrow: z.object({
      target: z.number().optional(),
      die: z.string().optional(),
    }).optional(),
    dmIfAlreadySkillAtLeast: z.array(z.object({
      skill: z.string(),
      level: z.number(),
      dm: z.number(),
    })).optional(),
  }).optional(),
  // Draft rules (F4/F17 — no OCS first term for drafted characters).
  draft: z.object({
    noCommissionFirstTerm: z.boolean().optional(),
  }).optional(),
  // Anagathics availability + survival DM.
  anagathics: z.looseObject({
    eligibility: z.looseObject({
      minAge: z.number().optional(),
      minTerms: z.number().optional(),
    }).optional(),
    availability: z.looseObject({
      target: z.number().optional(),
      dms: z.object({
        byStarport: z.record(z.string(), z.number()).optional(),
        byTech: z.record(z.string(), z.number()).optional(),
      }).optional(),
    }).optional(),
    survivalDm: z.number().optional(),
    nobleSurvivalDm: z.number().optional(),
    nobleService: z.string().optional(),
    agingAutoSavesPerTerm: z.number().optional(),
    cashRollCap: z.number().optional(),
    retry: z.unknown().optional(),
  }).optional(),
});

export type RulesData = z.infer<typeof RulesSchema>;

/** Validate an edition's `rules` sub-object. Returns the typed object
 *  on success; throws on shape failure. */
export function parseRules(rulesRaw: unknown, editionId: string): RulesData {
  return runSchema(RulesSchema, rulesRaw ?? {}, editionId, "rules block");
}

// --- Canon data (non-rules) schemas ----------------------------------

const DMRuleSchema = z.looseObject({
  modifier: z.union([z.number(), z.literal("termNumber")]),
  attribute: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  description: z.string().optional(),
});

const CheckSchema = z.looseObject({
  target: z.number().nullable(),
  dm: z.array(DMRuleSchema).optional(),
  label: z.string().optional(),
  inverseToLeave: z.boolean().optional(),
  special: z.string().optional(),
});

const AutoSkillEntrySchema = z.looseObject({
  trigger: z.enum(["service", "rank", "term"]),
  rank: z.number().optional(),
  term: z.number().optional(),
  skill: z.string().optional(),
  level: z.number().optional(),
  effect: z.string().optional(),
});

const SkillTableSchema = z.array(z.string().nullable());

const ServiceDataSchema = z.looseObject({
  // source / bookPage are documentation only — engine doesn't read them.
  // Optional to accommodate editions that don't include them in JSON.
  source: z.string().optional(),
  bookPage: z.number().optional(),
  displayName: z.string(),
  startAge: z.number(),
  draft: z.number().nullable(),
  checks: z.looseObject({
    enlistment: CheckSchema,
    survival: CheckSchema,
    position: CheckSchema.nullable(),
    promotion: CheckSchema.nullable(),
    reenlistment: CheckSchema,
    specialDuty: z.looseObject({ target: z.number() }).optional(),
  }),
  ranks: z.array(z.string().nullable()),
  automaticSkills: z.array(AutoSkillEntrySchema),
  hooks: z.looseObject({
    doPromotion: z.string().optional(),
  }).optional(),
  skillTables: z.looseObject({
    personalDevelopment: SkillTableSchema,
    serviceSkills: SkillTableSchema,
    advancedEducation: SkillTableSchema,
    advancedEducation8Plus: SkillTableSchema,
  }),
  musterOut: z.looseObject({
    benefits: z.array(z.string().nullable()),
    cash: z.array(z.number().nullable()),
  }),
  notes: z.array(z.string()).optional(),
});

// Records keyed by string with $comment / $rule citation entries mixed
// in. Citation values are strings; real values are validated against
// `valueSchema`. The union accepts both.
function recordWithCitations<V extends z.ZodTypeAny>(valueSchema: V) {
  return z.record(z.string(), z.union([valueSchema, z.string()]));
}

const CascadeSkillsSchema = recordWithCitations(z.array(z.string()));
const AttributeAbbreviationsSchema = recordWithCitations(z.string());
const SkillLabelRenamesSchema = recordWithCitations(z.string());
const IncludesSkillsSchema = recordWithCitations(z.array(z.string()));

const AgingEffectSchema = z.looseObject({
  delta: z.number(),
  save: z.number().optional(),
});

const AgingRowSchema = z.looseObject({
  // PM uses "66+" for the open band; CT uses a number; both legal.
  age: z.union([z.number(), z.string()]),
  endOfTerm: z.number(),
  effects: z.record(z.string(), AgingEffectSchema),
});

const AgingSchema = z.looseObject({
  source: z.string().optional(),
  startsAfterFourthTerm: z.boolean().optional(),
  rows: z.array(AgingRowSchema),
  unaffected: z.array(z.string()).optional(),
  agingCrisis: z.looseObject({
    whenAttributeReducedTo: z.number().optional(),
    save: z.number().optional(),
    dice: z.string().optional(),
  }).optional(),
});

const CanonDataSchema = z.looseObject({
  services: z.record(z.string(), ServiceDataSchema),
  cascadeSkills: CascadeSkillsSchema.optional(),
  attributeAbbreviations: AttributeAbbreviationsSchema.optional(),
  skillLabelRenames: SkillLabelRenamesSchema.optional(),
  includesSkills: IncludesSkillsSchema.optional(),
  aging: AgingSchema.optional(),
});

export type CanonDataValidated = z.infer<typeof CanonDataSchema>;

/** Validate the non-rules canon blocks. Run alongside parseRules at
 *  edition load. Throws with a path-prefixed message on shape failure. */
export function parseCanonData(raw: unknown, editionId: string): CanonDataValidated {
  return runSchema(CanonDataSchema, raw, editionId, "canon data");
}

function runSchema<T extends z.ZodTypeAny>(
  schema: T, raw: unknown, editionId: string, blockName: string,
): z.infer<T> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Edition ${editionId} ${blockName} failed schema validation:\n${issues}`,
    );
  }
  return result.data;
}
