// Runtime validation for the edition `rules` block. The engine reads
// nested paths from `edition.data.rules` in many places (skill cap,
// attribute caps, reenlistment, retirement, muster-out rolls, etc.).
// Previously each call site cast via `as { ... }`, which silently
// accepted typos and structural drift. This schema validates once at
// edition load (in `getEdition`) and throws on shape errors.
//
// We model only the `rules` sub-object here. The rest of the edition
// JSON (services, skill tables, ACG data) is consumed via existing
// CanonData types and per-feature schemas in their own modules.

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

export const RulesSchema = z.object({
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
      z.string(), // $rule / $comment citation
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
  musterDm: z.object({
    cashTableDm: z.array(z.unknown()).optional(),
    benefitTableDm: z.array(z.unknown()).optional(),
    maxCashTableRolls: z.number().optional(),
    cashRollLimit: z.number().optional(),
  }).passthrough().optional(),
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
  anagathics: z.unknown().optional(),
}).passthrough();

export type RulesData = z.infer<typeof RulesSchema>;

/** Validate an edition's `rules` sub-object. Returns the typed object
 *  on success; throws z.ZodError on shape failure. */
export function parseRules(rulesRaw: unknown, editionId: string): RulesData {
  const result = RulesSchema.safeParse(rulesRaw ?? {});
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Edition ${editionId} rules block failed schema validation:\n${issues}`,
    );
  }
  return result.data;
}
