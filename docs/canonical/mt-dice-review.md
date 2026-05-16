# MegaTraveller character generation dice review

A side-by-side review of dice mechanics in MT character generation versus
Classic Traveller. Sources: _MegaTraveller Players' Manual_ printed pages
14–17 (basic chargen lifecycle), 20–25 (basic chargen tables), 44–65
(Advanced Character Generation), 47 (aging).

The summary up front: **MT basic chargen uses the same dice as CT** —
2d6 for service checks, 1d6 for draft / skill table / muster-out, 2d6
for aging saves, 2d6 for attribute rolls. The interesting deltas are
elsewhere (Special Duty, double-bonus overshoot, brownie points,
decorations).

## Identical between CT and MT

| Roll | Dice | Notes |
|---|---|---|
| Initial attributes (UPP) | 2d6 each | 6 attributes, modified player range 1–15 |
| Enlistment | 2d6 vs target | DMs by attribute thresholds |
| Survival | 2d6 vs target | DMs by attribute thresholds; failure = death (or invalid-out) |
| Commission | 2d6 vs target | DMs by attribute thresholds; rank 0 → 1 |
| Promotion | 2d6 vs target | DMs by attribute thresholds; rank +1 |
| Reenlistment | 2d6 vs target | Roll exactly 12 = mandatory reenlist |
| Draft (post-failed-enlistment) | 1d6 | Maps to one of 6 services |
| Skill-table cell roll | 1d6 | Player chooses which of 4 tables |
| Muster-out roll | 1d6 | Plus cash/benefit DM as applicable |
| Aging save | 2d6 vs threshold | Per attribute, per term band |

## New in MT (basic chargen)

| Mechanic | Description | Wired? |
|---|---|---|
| **Special Duty** | A fifth per-term check (2d6 vs target). Success grants +1 skill. | ✅ Wired (`specialDutyStep`). |
| **Double-bonus on overshoot** | Commission / Promotion / Special Duty roll target+4 or higher grants +2 skills instead of +1. | ✅ Wired (`config.doubleBonusOvershoot: 4` on each step). |
| **Term-1 bonus skill** for `skillsPerTerm=1` services | First term grants +1 extra skill (matches CT's "initialTerm: 2" effect). | ✅ Wired (`config.term1Bonus: true` on allocateSkills). |
| **Prospecting-1+ cash DM** | Characters in merchants / belters / pirates / rogues / hunters / barbarians get +1 cash DM if they have Prospecting-1. | ✅ Wired (`rules.musterOutRolls.cashTableDm` + new `engine/musterDm.ts`). |
| **Retired cash DM** | Retired characters get +1 cash DM. | ✅ Wired (same place). |
| **All rank bands +1 muster roll** (vs CT's +1 / +2 / +3 by tier) | MT compresses the rank bonus to a flat +1 across all six ranks. | ✅ Wired (`rules.musterOutRolls.rankBands`). |
| **Per-term muster rolls = 2** (vs CT's 1) | MT gives 2 rolls per completed term. | ✅ Wired (`rules.musterOutRolls.perTerm`). |
| **Belter survival DM by terms** | Belters get +1 per term served on survival. Identical to CT. | ✅ Wired (`modifier: "termNumber"` in DM array). |

## New in MT ACG only (no CT equivalent)

| Mechanic | Description | Wired? |
|---|---|---|
| **Brownie points** | One-use post-roll DMs, awarded for each completed term (and academy graduation, decorations, etc.). | ⚠️ Partially. `brownieAwardStep` awards 1 per term. Spending brownie points post-roll isn't yet implemented (and would require player choice, so it interacts with interactive-mode). |
| **Decoration roll** | After survival, an additional 2d6 vs target check. Pass → MCUF, +3 → MCG, +6 → SEH. Target varies by branch / assignment in full ACG; we use a flat 10+ as the placeholder. | ⚠️ Partially. `decorationCheckStep` runs each term and awards the right medal for the margin, but uses a single target rather than reading from the assignment resolution table. |
| **Pre-career options** | College, OTC, NOTC, service academies — each is its own roll sequence before term 1. Can fail (academic dismissal) or succeed (start with O1 rank, extra skill). | ❌ Not wired. Future work. |
| **Branch assignment** | Per-term roll within pathway (Navy: Line/Engineering/Gunnery/Flight/Intelligence). | ❌ Not wired. The pathway is recorded on the character but branch assignment isn't rolled. |
| **Specialist school** | Per-term roll for assignment to a specialist school. Each school grants its own skill. | ❌ Not wired. |
| **MOS** (Mercenary) | Military Occupational Specialty. | ❌ Not wired (recorded as a free-form string but not auto-assigned). |
| **Court martial** | Triggered by certain failures. -1 or worse to next promotion, rank reduction, or discharge. | ❌ Not wired. |
| **Skill margin doubling for skill picks** | `doubleSkillMargin: 4` rule (margin of 4 over target gives 2 skills, not 1) — applies the same as commission/promotion. | ✅ Wired (same as basic chargen). |

## Decoration mechanics — the closest dice surprise

MT introduces the idea that a *negative* survival DM can be *converted* to
a positive decoration DM (and vice versa), so a character with bad
attributes for survival can still earn medals by accepting heroic risk.
The full system requires per-assignment decoration targets (e.g., raid 6+,
internal security 12+) which vary by pathway and current duty. The
canonical data is in `advancedCharacterGeneration.mercenary.assignmentResolution`
(and the equivalents for the other pathways) but the runtime engine
currently uses a single fixed target (10+) per the simplification noted
above.

If/when ACG assignment rolls are wired, the decoration step needs to:

1. Read the current assignment's decoration target from the resolution table.
2. Apply any survival → decoration DM conversion the player has elected.
3. Use the actual target rather than the placeholder.

## Net effect on the codebase

Everything that's "wired ✅" came through declarative JSON. The handful
that's "partial ⚠️" or "not wired ❌" represents the remaining ACG runtime
work — none of it requires new dice mechanics, just more table-lookup
plumbing in the step registry.
