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

const RankExtraRollSchema = z.object({
  rankMin: z.number(),
  rankMax: z.number(),
  additionalRolls: z.number(),
});

export const RulesSchema = z.looseObject({
  // Skill-cap (PM p. 39 Int+Edu cap). Presence indicates the edition
  // enforces a per-character skill-level total cap; `attributes` names the
  // operands summed to form the cap (looseObject keeps the $rule citation).
  skillCap: z.looseObject({
    attributes: z.array(z.string()).optional(),
  }).optional(),
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
    voluntaryAnyTerms: z.boolean().optional(),
  }).optional(),
  // Retirement / pension.
  retirement: z.object({
    eligibleAfterCompletedTerm: z.number().optional(),
    basePensionCredits: z.number().optional(),
    pensionCreditsPerTerm: z.number().optional(),
    excludedServices: z.array(z.string()).optional(),
    anagathicTermsExcluded: z.boolean().optional(),
  }).optional(),
  // Muster-out roll counts AND DM tables. Engine reads from this block
  // (musterDm.ts). The DM tables (cashTableDm/benefitTableDm) and the
  // hard cap (maxCashTableRolls) live here too — they were previously
  // stripped by the schema, which made the engine read empty objects
  // and silently apply DM=0 for Gambling/rank 5+.
  musterOutRolls: z.looseObject({
    perTerm: z.number().optional(),
    rankExtraRolls: z.array(RankExtraRollSchema).optional(),
    rankExtraRollsBySource: z.record(z.string(), z.array(RankExtraRollSchema)).optional(),
    cashTableDm: z.array(z.looseObject({
      retired: z.boolean().optional(),
      skillAtLeast: z.looseObject({
        skill: z.string(),
        level: z.number(),
      }).optional(),
      serviceIn: z.array(z.string()).optional(),
      dm: z.number(),
    })).optional(),
    benefitTableDm: z.looseObject({
      rankNumAtLeast: z.number().optional(),
      dm: z.number(),
    }).optional(),
    maxCashTableRolls: z.number().optional(),
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
  // Survival-failure consequence. CT defaults to death; MT to shortTerm.
  survival: z.object({
    onFailure: z.enum(["death", "shortTerm"]).optional(),
    shortTermYears: z.number().optional(),
    fullTermYears: z.number().optional(),
  }).optional(),
  // ACG pre-career consequences (PM p. 44): wash-out aging, the short
  // three-year first term, and the college Education-gain floor. MT-only
  // (editions without ACG omit the block); when present all three values
  // are required so a partial declaration fails at load.
  preCareer: z.looseObject({
    shortFirstTermYears: z.number(),
    washOutAgeYears: z.number(),
    educationGainFloor: z.number(),
  }).optional(),
  // Skill-eligibility table-row counts (CT/MT divergence).
  skillEligibility: z.object({
    initialTerm: z.number().optional(),
    subsequentTerm: z.number().optional(),
    perTermExceptions: z.record(z.string(), z.number()).optional(),
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
  // Homeworld skill restrictions (MT p. 39) — consumed by
  // engine/skillRestrictions.ts. Present only in editions with a homeworld
  // block; modeled here so the consumer reads the validated `ed.rules` view
  // rather than an unchecked raw `data.rules` cast.
  homeworldSkillRestrictions: z.looseObject({
    rule: z.string().optional(),
    source: z.string().optional(),
    overrideTarget: z.number(),
    exemptServices: z.array(z.string()),
    weaponLawLowerServices: z.array(z.string()).optional(),
    vehicleSkillTech: z.record(z.string(), z.string()),
    weaponSkillTech: z.record(z.string(), z.string()),
    weaponSkillMaxLaw: z.record(z.string(), z.string()),
  }).optional(),
});

export type RulesData = z.infer<typeof RulesSchema>;

/** Validate an edition's `rules` sub-object. Returns the typed object
 *  on success; throws on shape failure. */
export function parseRules(rulesRaw: unknown, editionId: string): RulesData {
  return runSchema(RulesSchema, rulesRaw ?? {}, editionId, "rules block");
}

/** Reject unknown keys except `$rule` / `$comment` citation annotations.
 *  For closed blocks whose full field set is modeled, so a typo'd key fails
 *  at load while the JSON's rulebook citations stay legal. */
function strictCitations<T extends z.ZodRawShape>(shape: T) {
  const allowed = new Set(Object.keys(shape));
  return z.object(shape).catchall(z.unknown()).superRefine((val, ctx) => {
    for (const key of Object.keys(val)) {
      if (!allowed.has(key) && !key.startsWith("$")) {
        ctx.addIssue({ code: "custom", message: `Unknown key "${key}"`, path: [key] });
      }
    }
  });
}

// --- Canon data (non-rules) schemas ----------------------------------

const DMRuleSchema = z.strictObject({
  dm: z.number().optional(),
  dmPerTerm: z.number().optional(),
  attribute: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  description: z.string().optional(),
}).refine(
  (r) => (r.dm !== undefined) !== (r.dmPerTerm !== undefined),
  { message: "DMRule needs exactly one of `dm` or `dmPerTerm`" },
);

const CheckSchema = z.looseObject({
  target: z.number().nullable(),
  dms: z.array(DMRuleSchema).optional(),
  inverseToLeave: z.boolean().optional(),
  // CotI auto-enrolment gate (e.g. Nobles): enlistment succeeds automatically
  // when the named attribute meets `min`.
  automaticIf: z.looseObject({
    attribute: z.string(),
    min: z.number(),
  }).optional(),
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
  // MT-only explicit skills-per-term (PM p. 60 service tables).
  skillsPerTerm: z.number().optional(),
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
  // CotI nobles: starting rank derives from Social Standing each term.
  rankBySocial: z.looseObject({
    socialFloor: z.number(),
    rankOffset: z.number(),
    maxRank: z.number(),
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
  // PM p. 15 anagathics withdrawal: each aging save is made twice and
  // both must pass. Declared only by editions with the anagathics rule.
  withdrawalDoubleSave: z.boolean().optional(),
  rows: z.array(AgingRowSchema),
  agingCrisis: z.looseObject({
    whenAttributeReducedTo: z.number().optional(),
    save: z.number().optional(),
    dice: z.string().optional(),
    // PM p. 47 / TTB p. 24: value the reduced characteristic is restored
    // to when the crisis save passes.
    restoreTo: z.number().optional(),
  }).optional(),
});

// --- ACG (Advanced Character Generation) schemas ---------------------

const PhaseConfigSchema = z.looseObject({
  kind: z.enum(["survival", "promotion", "decoration", "skills", "bonus"]),
  consequence: z.string().optional(),
  onMitigatedRevive: z.string().optional(),
  endChargenOnFail: z.looseObject({
    kind: z.enum(["retired", "deceased"]),
    reason: z.string(),
    withPension: z.boolean().optional(),
  }).optional(),
  purpleHeartOnExactCombat: z.boolean().optional(),
  onPass: z.string().optional(),
  skipIfNotBureaucracy: z.boolean().optional(),
  consumeNextPromotionPenalty: z.boolean().optional(),
  logPenaltyInNote: z.boolean().optional(),
  consequenceMild: z.string().optional(),
  consequenceSevere: z.string().optional(),
  courtMartialMarginThreshold: z.number().optional(),
});

const ResolveAssignmentConfigSchema = z.looseObject({
  preRun: z.union([z.literal("decorationDmTradeoff"), z.null()]).optional(),
  phases: z.array(PhaseConfigSchema),
  finalize: z.string().optional(),
});

// Sub-table for resolveAssignment rows. The garrisonDuty entry (PM p. 49)
// is not column-based: it declares survival/decoration/skills targets and
// an enlisted-only promotion throw instead of columns/rows.
const AssignmentResolutionSubSchema = z.looseObject({
  columns: z.array(z.string()).optional(),
  rows: z.array(z.looseObject({})).optional(),
  survival: z.string().optional(),
  decoration: z.string().optional(),
  skills: z.string().optional(),
  enlistedPromotion: z.string().optional(),
});

// PM p. 51/55: rank-keyed Service Skills column policy. shipsTroopsColumn
// is mercenary-only (Marines on Ship's Troops); enlistedLowRankDefault is
// navy-only (Navy Life applies to every branch).
const SkillColumnPolicySchema = z.looseObject({
  officerInCommand: z.string(),
  officerStaff: z.string(),
  enlistedNcoColumn: z.string(),
  enlistedNcoMinRank: z.string(),
  enlistedLowRankColumns: z.record(z.string(), z.string()),
  enlistedLowRankDefault: z.string().optional(),
  shipsTroopsColumn: z.string().optional(),
});

const PathwayDataSchema = z.looseObject({
  enlistment: z.union([z.looseObject({}), z.array(z.looseObject({}))]).optional(),
  // PM p. 52: declared, order-significant navy fleet enumerable (option domain).
  fleets: z.array(z.string()).optional(),
  // PM pp. 50/52/56/60: declared, order-significant ACG enlistment
  // option-domain enumerables — mercenary services, navy subsector-tech
  // ceilings, scout divisions, merchant line types.
  services: z.array(z.string()).optional(),
  subsectorTechOptions: z.array(z.string()).optional(),
  divisions: z.array(z.string()).optional(),
  lineTypes: z.array(z.string()).optional(),
  ranks: z.looseObject({
    enlisted: z.array(z.unknown()).optional(),
    officer: z.array(z.unknown()).optional(),
  }).optional(),
  reenlistment: z.looseObject({}).optional(),
  combatAssignments: z.array(z.string()).optional(),
  resolveAssignment: ResolveAssignmentConfigSchema.optional(),
  skillColumnPolicy: SkillColumnPolicySchema.optional(),
  // PM p. 56: scout entry-route -> division placement.
  divisionPlacement: z.looseObject({
    collegeGraduate: z.enum(["field", "bureaucracy"]),
    medSchoolCommission: z.enum(["field", "bureaucracy"]),
    default: z.enum(["field", "bureaucracy"]),
  }).optional(),
  assignmentResolution: z.record(
    z.string(),
    z.union([AssignmentResolutionSubSchema, z.string()]),
  ).optional(),
});

const AcgCommonSchema = z.looseObject({
  // Record values allow $rule / $comment citation strings alongside the
  // structured objects (the same dual-shape pattern used by RulesSchema
  // for nobleTitles).
  preCareerOptions: z.record(
    z.string(),
    z.union([z.looseObject({}), z.string()]),
  ).optional(),
  courtMartial: z.looseObject({}).optional(),
  browniePoints: z.looseObject({
    awards: z.array(z.looseObject({
      event: z.string(),
      points: z.number(),
    })).optional(),
  }).optional(),
  decorationTiers: z.looseObject({
    tiers: z.array(z.looseObject({
      minMargin: z.number(),
      award: z.string(),
    })).optional(),
  }).optional(),
  // PM p. 49 survival <-> decoration DM tradeoff option bounds.
  decorationDmTradeoff: z.looseObject({
    min: z.number(),
    max: z.number(),
    step: z.number(),
  }).optional(),
});

const AcgDataSchema = z.looseObject({
  common: AcgCommonSchema,
  // PM p. 44/64: declared, order-significant ACG pathway enumerable.
  pathways: z.array(z.string()).optional(),
  mercenary: PathwayDataSchema.optional(),
  navy: PathwayDataSchema.optional(),
  scout: PathwayDataSchema.optional(),
  merchantPrince: PathwayDataSchema.optional(),
});

const BenefitDetailSchema = z.looseObject({
  shipType: z.string().optional(),
  displayName: z.string().optional(),
  firstReceiptMortgageYears: z.number().optional(),
  repeatReducesMortgageYears: z.number().optional(),
  repeat: z.string().optional(),
  description: z.string().optional(),
});

const SkillTableMetaSchema = strictCitations({
  order: z.array(z.string()),
  displayNames: z.record(z.string(), z.string()),
  advancedEducationEduMin: z.number(),
});

const EditionMetaSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  rulebooks: z.array(z.string()),
  chargenModels: z.array(z.string()).min(1),
  status: z.enum(["active", "data-only"]).optional(),
  supportsInteractive: z.boolean().optional(),
  year: z.number().optional(),
  description: z.string().optional(),
});

// --- Mongoose Traveller 2e data (loose objects preserve $rule citations) ----
const MongooseCheckSchema = z.looseObject({
  characteristics: z.array(z.string()),
  target: z.number(),
  ageDm: z.looseObject({ minAge: z.number(), dm: z.number() }).optional(),
  autoQualifyAtLeast: z.looseObject({ attribute: z.string(), value: z.number() }).optional(),
});
const MongooseSkillColumnSchema = z.array(z.string().nullable());
const MongooseRankSchema = z.looseObject({
  rank: z.number(),
  title: z.string().nullable(),
  benefit: z.string().nullable(),
});
// Effects are validated structurally (kind present); the engine's exhaustive
// switch is the semantic validator and throws on an unknown kind.
const MongooseEffectSchema = z.looseObject({ kind: z.string() });
const MongooseTableRowSchema = z.looseObject({
  roll: z.number(),
  text: z.string(),
  effects: z.array(MongooseEffectSchema),
});
const MongooseCareerSchema = z.looseObject({
  id: z.string(),
  displayName: z.string(),
  qualification: MongooseCheckSchema,
  commission: MongooseCheckSchema.optional(),
  basicTrainingFromAssignment: z.boolean().optional(),
  assignments: z.array(z.looseObject({
    id: z.string(),
    displayName: z.string(),
    survival: MongooseCheckSchema,
    advancement: MongooseCheckSchema,
    skills: MongooseSkillColumnSchema,
  })),
  skillTables: z.looseObject({
    personalDevelopment: MongooseSkillColumnSchema,
    serviceSkills: MongooseSkillColumnSchema,
    advancedEducation: MongooseSkillColumnSchema.nullable(),
    advancedEducationEduMin: z.number().nullable(),
    officer: MongooseSkillColumnSchema.optional(),
  }),
  ranks: z.looseObject({
    enlisted: z.record(z.string(), z.array(MongooseRankSchema)),
    enlistedByAssignment: z.record(z.string(), z.string()),
    officer: z.array(MongooseRankSchema).optional(),
  }),
  events: z.array(MongooseTableRowSchema),
  mishaps: z.array(MongooseTableRowSchema),
  musterOut: z.array(z.looseObject({
    roll: z.number(),
    cash: z.number(),
    benefit: z.string(),
  })),
  forcedOnly: z.boolean().optional(),
  parole: z.looseObject({
    dice: z.string(),
    plus: z.number(),
    max: z.number(),
  }).optional(),
});
const MongooseReductionSchema = z.looseObject({
  count: z.number(),
  amount: z.union([z.number(), z.string()]),
  pool: z.array(z.string()),
});
const MongooseDataSchema = z.looseObject({
  startAge: z.number(),
  termLengthYears: z.number(),
  characteristicDmBands: z.array(
    z.looseObject({ min: z.number(), max: z.number(), dm: z.number() }),
  ),
  backgroundSkillBase: z.number(),
  backgroundSkills: z.array(z.string()),
  draft: z.array(z.looseObject({
    roll: z.number(),
    career: z.string(),
    assignment: z.string(),
  })),
  careers: z.record(z.string(), MongooseCareerSchema),
  agingStartTerm: z.number(),
  cashRollCap: z.number(),
  commissionAnyTermSocMin: z.number(),
  skillLevelMax: z.number(),
  skillTotalCap: z.looseObject({ multiplier: z.number(), attributes: z.array(z.string()) }),
  connectionSkillCap: z.number(),
  connectionSkillMaxLevel: z.number(),
  benefitsOfRank: z.array(z.looseObject({
    minRank: z.number(),
    maxRank: z.number(),
    bonusRolls: z.number(),
    benefitDm: z.number().optional(),
  })),
  pensions: z.looseObject({
    minTerms: z.number(),
    excludedCareers: z.array(z.string()),
    table: z.array(z.looseObject({ terms: z.number(), pay: z.number() })),
    beyondTerm: z.number(),
    perTermPay: z.number(),
  }),
  injury: z.array(z.looseObject({
    roll: z.number(),
    text: z.string(),
    reductions: z.array(MongooseReductionSchema),
  })),
  aging: z.array(z.looseObject({
    threshold: z.number(),
    text: z.string(),
    reductions: z.array(MongooseReductionSchema),
  })),
  lifeEvents: z.array(MongooseTableRowSchema),
  lifeEventsUnusual: z.array(MongooseTableRowSchema),
  cashBonusSkill: z.looseObject({ skill: z.string(), dm: z.number() }),
  connectionSkillExcluded: z.array(z.string()),
  qualificationDmPerPriorCareer: z.number(),
  commissionDmPerTermAfterFirst: z.number(),
  agingDmPerTerm: z.number(),
  lifeEventsUnusualTrigger: z.number(),
  draftFallbackCareer: z.string(),
  survivalNaturalFail: z.number(),
  advancementNaturalContinue: z.number(),
});

const CanonDataSchema = z.looseObject({
  edition: EditionMetaSchema.optional(),
  services: z.record(z.string(), ServiceDataSchema),
  // Top-level presentation/enlistment order of ALL of an edition's services
  // (CT: TTB p. 18 service-selection table; MT: PM service order). The
  // enlistable pool (services.ts) and optionDomain("classic.service") both
  // read this list, minus automaticIf-gated services. `$ruleServiceOrder`
  // is its sibling citation (kept by z.looseObject).
  serviceOrder: z.array(z.string()).optional(),
  cascadeSkills: CascadeSkillsSchema.optional(),
  attributeAbbreviations: AttributeAbbreviationsSchema.optional(),
  skillLabelRenames: SkillLabelRenamesSchema.optional(),
  includesSkills: IncludesSkillsSchema.optional(),
  aging: AgingSchema.optional(),
  advancedCharacterGeneration: AcgDataSchema.optional(),
  benefitDetails: z.record(z.string(), BenefitDetailSchema).optional(),
  skillTableMeta: SkillTableMetaSchema.optional(),
  cascadeAliases: z.record(z.string(), z.string()).optional(),
  // Presentation metadata for the printed sheet (lib/pdfSheet).
  sheet: strictCitations({
    equipmentSkills: z.array(z.string()),
  }).optional(),
  mongoose: MongooseDataSchema.optional(),
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
