"use client";

import { useEffect, useRef, useState } from "react";
import { Character, cloneCharacter } from "@/lib/traveller/character";
import { benefitDmFor, cashDmFor, maxCashRolls } from "@/lib/traveller/engine/musterDm";
import { DEFAULT_EDITION_ID, getEdition, listEditions } from "@/lib/traveller/editions";
import { editionHasAcg, listAcgPathways } from "@/lib/traveller/engine/acg";
import { runAcgYear } from "@/lib/traveller/engine/acg/runner";
import {
  isPreCareerEligible, preCareerLabel, preCareerUiSummary,
} from "@/lib/traveller/engine/acg/preCareer";
import { ChoicePendingError } from "@/lib/traveller/engine/choices";
import { event as ev, formatEvent, visibleAt } from "@/lib/traveller/history";
import {
  getEditionServices,
  getEnlistableServices,
  serviceLabel,
} from "@/lib/traveller/services";
import { aggregateBenefits } from "@/lib/traveller/sheet";
import { extendedHex, intToOrdinal, numCommaSep } from "@/lib/traveller/formatting";
import type { AttributeKey, ServiceKey } from "@/lib/traveller/types";
import { downloadCharacterSheetPdf } from "@/lib/pdfSheet";

type Phase =
  | "start"
  | "pre_career"
  | "acg_enlist"
  | "career"
  | "term"
  | "skill_basic"
  | "skill_adv"
  | "muster"
  | "muster_no_cash"
  | "end";


/** Mercenary combat arms available in the enlistment dropdown, sourced
 *  from the edition JSON. Commando is filtered out (its honors-graduate
 *  gate is enforced by mercenaryEnlist) so the dropdown only lists arms
 *  the player can actually choose at first enlistment. */
function mercenaryNonCommandoArms(editionId: string): string[] {
  const acg = getEdition(editionId).data.advancedCharacterGeneration as
    Record<string, unknown> | undefined;
  const merc = acg?.mercenary as { combatArms?: string[]; combatArmEligibility?: {
    armGates?: Record<string, unknown>;
  } } | undefined;
  const arms = merc?.combatArms ?? [];
  const gated = new Set(Object.keys(merc?.combatArmEligibility?.armGates ?? {}));
  return arms.filter((a) => !gated.has(a));
}

function pickSkillPhase(c: Character): Phase {
  return c.attributes.education >= 8 ? "skill_adv" : "skill_basic";
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("start");
  const [character, setCharacter] = useState<Character | null>(null);
  // Default to verbose history so the user sees every roll, skill grant,
  // and choice resolution. The header checkbox lets power users opt out.
  const [verbose, setVerbose] = useState(true);
  const [interactiveMode, setInteractiveMode] = useState(false);
  const [edition, setEdition] = useState<string>(DEFAULT_EDITION_ID);
  const [useAcg, setUseAcg] = useState(false);
  const [acgPathway, setAcgPathway] = useState<string>("");
  const [acgService, setAcgService] = useState<"army" | "marines">("army");
  const [acgCombatArm, setAcgCombatArm] = useState<string>("Infantry");
  const [acgFleet, setAcgFleet] = useState<
    "imperialNavy" | "reserveFleet" | "systemSquadron"
  >("imperialNavy");
  const [acgDivision, setAcgDivision] = useState<"field" | "bureaucracy">("field");
  const [acgLineType, setAcgLineType] = useState<string>("Free Trader");
  // PM p. 52: Navy ACG characters need a subsector tech code (usually the
  // capital's). Empty string = defer to beginAcg's homeworld-based default.
  const [acgSubsectorTech, setAcgSubsectorTech] = useState<string>("");
  // PM p. 47 Rrev5: Merchant Academy "may apply" — opt-in for Megacorp /
  // Sector-wide. Default off; UI surfaces a checkbox.
  const [acgMerchantAcademy, setAcgMerchantAcademy] = useState(false);
  const [preferredService, setPreferredService] = useState<
    ServiceKey | "random"
  >("random");

  // Mirror the character state in a ref. Each handler reads from the ref and
  // updates it synchronously before calling setCharacter — so rapid back-to-
  // back clicks always operate on the latest character, not a stale closure.
  // Functional setState would seem like the React-idiomatic fix here, but its
  // updater body would be re-invoked in dev StrictMode, re-rolling dice.
  const characterRef = useRef<Character | null>(null);
  useEffect(() => {
    characterRef.current = character;
  }, [character]);

  const commit = (c: Character, p: Phase) => {
    characterRef.current = c;
    setCharacter(c);
    setPhase(p);
  };

  const startCareer = () => {
    const c = new Character();
    c.editionId = edition;
    c.showHistory = verbose ? "verbose" : "simple";
    // MT homeworld generation (p. 12-13) — runs after attribute roll
    // (which happens in the Character constructor) and BEFORE service
    // selection. Gates which careers the character can enlist in.
    c.generateHomeworld();
    // Only enable interactive mode if the active edition opts in (CT does
    // not). This makes the chosen edition's metadata the authority — the
    // checkbox is disabled in that case but we double-guard the flag here.
    const editionMeta = listEditions().find((e) => e.id === edition);
    c.choiceMode = (interactiveMode && editionMeta?.supportsInteractive)
      ? "interactive"
      : "auto";
    // ACG is only available on editions that declare it, and only when
    // the user picks a pathway. Double-guard: ignore the flag if either
    // condition fails.
    if (useAcg && editionHasAcg(edition) && acgPathway) {
      c.useAcg = true;
      c.acgPathway = acgPathway;
      // ACG characters get a pre-career phase first (college / academy /
      // medical / flight school) before enlistment. Honors graduates can
      // chain; academy graduates auto-route into their pathway. Sub-options
      // (service, combat arm, fleet, etc.) are configured at acg_enlist
      // after pre-career, since pre-career outcomes can change them
      // (Naval Academy honors auto-routes to Navy; OTC chooses Army/Marines
      // mid-college).
      commit(c, "pre_career");
      return;
    }
    commit(c, "career");
  };

  /** Apply a pre-career option. Honors a chained-academic-progression: an
   *  honors college grad may chain into medical/flight school; an academy
   *  honors grad may try medical/flight. After the option completes, route
   *  the player to either another pre-career attempt or to enlistment. */
  const applyPreCareer = (opt:
    | "college" | "navalAcademy" | "militaryAcademy" | "merchantAcademy"
    | "medicalSchool" | "flightSchool"
    | "skip"
  ) => {
    const prev = characterRef.current;
    if (!prev) return;
    const c = cloneCharacter(prev);
    if (opt === "skip") {
      commit(c, c.useAcg ? "acg_enlist" : "career");
      return;
    }
    let r: ReturnType<typeof c.doPreCareer>;
    try {
      r = c.doPreCareer(opt);
    } catch (err) {
      // Interactive pre-career (OTC branch pick, college honors paths)
      // throws ChoicePendingError; commit the clone with the queued
      // choice in pendingChoices so the UI can present it.
      if (!(err instanceof ChoicePendingError)) throw err;
      commit(c, "pre_career");
      return;
    }
    // Record the auto-enlist pathway (used as a default on the enlist
    // screen) but DON'T route to enlist yet. Per PM p. 47, academy honors
    // graduates may chain into Medical or Flight School before service
    // begins — the player chooses Skip when they're done. PreCareerPhase
    // gates which chain options are visible (medAvailable / flightAvailable),
    // and once none remain available it only shows Skip.
    if (r.autoEnlistPathway) {
      c.acgPathway = r.autoEnlistPathway;
      setAcgPathway(r.autoEnlistPathway);
      // Pre-populate enlistment sub-options from the academy outcome so
      // the acg_enlist screen reflects what pre-career decided.
      const branch = c.acgState?.preCareerBranch;
      if (branch === "army" || branch === "marines") setAcgService(branch);
      if (r.autoEnlistPathway === "navy" && opt === "navalAcademy") {
        setAcgFleet("imperialNavy");
      }
    }
    commit(c, "pre_career");
  };

  const resolvePending = (choiceId: string, optionIdx: number) => {
    const prev = characterRef.current;
    if (!prev) return;
    const c = cloneCharacter(prev);
    // resolveChoice may itself queue a nested cascade (e.g., resolving a
    // skill-table pick rolls a cascade cell). Catch ChoicePendingError so
    // we still commit and let the UI surface the next choice.
    try {
      c.resolveChoice(choiceId, optionIdx);
    } catch (err) {
      if (!(err instanceof ChoicePendingError)) throw err;
    }

    // If the ACG runner had paused on this choice, resume it. After the
    // queued closure ran, the year's state is consistent and runAcgYear
    // continues from acgState.pausedAtStep. If more choices come up
    // they'll throw again and we'll bounce back to the choice UI.
    if (c.useAcg && c.acgState?.pausedAtStep && c.pendingChoices.length === 0) {
      try {
        runAcgYear(c);
      } catch (err) {
        if (!(err instanceof ChoicePendingError)) throw err;
      }
    }

    // More choices still pending — stay in the current phase.
    if (c.pendingChoices.length > 0) {
      commit(c, phase);
      return;
    }

    // Basic-chargen: drive the workflow forward once the choice queue
    // drains so the user sees a clean stage transition (skill → term-end,
    // term → muster, muster → end). Without this, the user can complete
    // a cascade and be left looking at a stale phase with no next action.
    if (!c.useAcg && (phase === "skill_basic" || phase === "skill_adv")) {
      if (c.skillPoints > 0) {
        commit(c, pickSkillPhase(c));
        return;
      }
      finishTerm(c);
      return;
    }
    commit(c, phase);
  };

  const enlist = () => {
    const prev = characterRef.current;
    if (!prev) return;
    const c = cloneCharacter(prev);
    c.showHistory = verbose ? "verbose" : "simple";
    if (c.useAcg && c.acgPathway) {
      // Rrev5: persist merchant academy opt-in into acgState before
      // beginAcg consumes it. Force lazy-init via browniePoints setter.
      if (c.acgPathway === "merchantPrince" &&
          (acgLineType === "Megacorp" || acgLineType === "Sector-wide") &&
          acgMerchantAcademy) {
        c.browniePoints = c.browniePoints;
        if (c.acgState) c.acgState.attemptMerchantAcademy = true;
      }
      // ACG: bypass basic doEnlistment and call the pathway-specific
      // enlist via beginAcg with the user's sub-option choices.
      try {
        c.beginAcg(c.acgPathway as "mercenary" | "navy" | "scout" | "merchantPrince", {
          service: acgService,
          combatArm: acgCombatArm,
          fleet: acgFleet,
          division: acgDivision,
          lineType: acgLineType,
          ...(acgSubsectorTech ? { subsectorTechCode: acgSubsectorTech } : {}),
        });
      } catch (err) {
        // beginAcg throws on enlistment rejection; surface to the user.
        // The character's chargen ends here, so emit endGeneration with
        // the failure reason embedded.
        c.log(ev.endGeneration("retired", `ACG enlistment failed: ${(err as Error).message}`));
        commit(c, "end");
        return;
      }
    } else {
      c.service = c.doEnlistment(
        preferredService === "random" ? "" : preferredService,
      );
    }
    commit(c, "term");
  };

  const runTerm = () => {
    const prev = characterRef.current;
    if (!prev) return;
    const c = cloneCharacter(prev);
    // CotI: Noble rank corresponds to Social Standing − 10 from the start
    // (B Knight at Soc 11 through F Duke at Soc 15).
    if (c.service === "nobles") {
      if (c.attributes.social < 10) c.attributes.social = 10;
      const startingRank = c.attributes.social - 10;
      if (c.rank < startingRank && startingRank >= 1 && startingRank <= 5) {
        c.rank = startingRank;
        c.commissioned = true;
      }
    }
    c.doServiceTermStep();

    if (c.deceased) {
      commit(c, "end");
      return;
    }
    if (c.skillPoints > 0) {
      // Aging deliberately deferred until after skill picks so the player's
      // Edu (which gates the Advanced Education 8+ table) reflects pre-aging
      // state. PM checklist: skills → aging → reenlistment.
      commit(c, pickSkillPhase(c));
      return;
    }
    // No skills to pick — proceed straight to aging + reenlistment for
    // basic chargen. ACG handles aging + reenlistment inside runAcgTerm
    // already, so we skip the duplicate aging call here for ACG characters.
    // The Int+Edu cap is still enforced in case homeworld defaults pushed
    // the total over (rare, but possible at low Int/Edu). In MT interactive
    // mode the cap throws ChoicePendingError to prompt the player which
    // skill to reduce — surface the choice via commit.
    if (!c.useAcg) {
      try {
        c.enforceSkillCap();
      } catch (err) {
        if (!(err instanceof ChoicePendingError)) throw err;
        commit(c, "term");
        return;
      }
    }
    if (!c.useAcg && !c.deceased) c.doAging();
    if (c.deceased) {
      commit(c, "end");
      return;
    }
    // ACG: runAcgTerm flips activeDuty to false at end-of-term when the
    // reenlistment roll fails, so the UI must route involuntary musters
    // here rather than dropping back into another term loop.
    if (!c.activeDuty) {
      c.enterMustered();
      c.musterRolls = c.musterOutRolls();
      if (c.musterRolls === 0) {
        c.musterOutPay();
        c.log(ev.endGeneration("mustered"));
        commit(c, "end");
      } else {
        commit(c, "muster");
      }
      return;
    }
    commit(c, "term");
  };

  const attemptMusterOut = () => {
    const prev = characterRef.current;
    if (!prev) return;
    // Per TTB p. 18 / PM p. 17: a roll-of-12 mandatory reenlistment forces
    // another term regardless of the character's preference. The reenlist
    // throw fired at the end of skill-picks already; this is the player's
    // *voluntary* decision to leave when they were eligible to stay. No
    // second 2D roll, no second aging — both already happened.
    if (prev.mandatoryReenlistment) return;
    const c = cloneCharacter(prev);
    // Voluntary muster — flip to "retired" (pension eligibility is
    // checked inside endChargenRetired via isRetirementEligible).
    c.endChargenRetired(`voluntary muster after ${intToOrdinal(c.terms)} term of service`);
    c.log(ev.statusChange(
      "voluntaryMuster",
      `after ${intToOrdinal(c.terms)} term of service`,
    ));
    c.enterMustered();
    c.musterRolls = c.musterOutRolls();
    if (c.musterRolls === 0) {
      c.musterOutPay();
      c.log(ev.endGeneration("mustered"));
      commit(c, "end");
    } else {
      commit(c, "muster");
    }
  };

  /** End-of-term sequence: cap, aging, reenlistment, muster routing.
   *  Called once skillPoints reach 0 and no cascade choices remain. */
  const finishTerm = (c: Character) => {
    // PM checklist: after the last skill pick, enforce the Int+Edu skill
    // cap (PM p. 39), then age, then run reenlistment. In MT interactive
    // mode the cap throws ChoicePendingError to prompt the player which
    // skill to reduce; commit so the UI surfaces it.
    try {
      c.enforceSkillCap();
    } catch (err) {
      if (!(err instanceof ChoicePendingError)) throw err;
      commit(c, "term");
      return;
    }
    if (!c.deceased) c.doAging();
    if (c.deceased) {
      commit(c, "end");
      return;
    }

    // Short-term characters (failed survival) are already mustering out;
    // they don't take a reenlistment throw. Same for any path that already
    // dropped activeDuty.
    if (!c.shortTermThisTerm && c.activeDuty && !c.deceased) {
      c.doReenlistmentStep();
    }

    if (c.deceased) {
      commit(c, "end");
      return;
    }

    if (!c.activeDuty) {
      c.enterMustered();
      c.musterRolls = c.musterOutRolls();
      if (c.musterRolls === 0) {
        c.musterOutPay();
        c.log(ev.endGeneration("mustered"));
        commit(c, "end");
      } else {
        commit(c, "muster");
      }
      return;
    }

    commit(c, "term");
  };

  const pickSkill = (table: number) => {
    const prev = characterRef.current;
    if (!prev) return;
    const c = cloneCharacter(prev);
    if (table === 0) {
      c.forceTable = false;
    } else {
      c.forceTable = true;
      c.forceTableIndex = table;
    }
    // Spend the skill point up front. acquireSkill may queue a cascade
    // (and throw ChoicePendingError) before the underlying skill grant
    // resolves; that's still "this skill point", so don't double-spend
    // on the cascade resolution.
    c.skillPoints -= 1;
    try {
      getEditionServices(c.editionId)[c.service]!.acquireSkill(c);
    } catch (err) {
      if (!(err instanceof ChoicePendingError)) throw err;
      // Cascade queued — commit so the UI surfaces it. The cascade
      // resolution flows through resolvePending below.
      commit(c, pickSkillPhase(c));
      return;
    }

    if (c.skillPoints > 0) {
      commit(c, pickSkillPhase(c));
      return;
    }

    finishTerm(c);
  };

  const musterChoice = (kind: "cash" | "benefit") => {
    const prev = characterRef.current;
    if (!prev) return;
    const c = cloneCharacter(prev);
    // Compute DMs from the active edition's rules.musterOutRolls block —
    // CT and MT differ on which conditions apply (MT adds Retired and
    // Prospecting-1 for select services).
    const cashDM = cashDmFor(c);
    const benefitsDM = benefitDmFor(c);

    try {
      if (kind === "cash") {
        c.musterOutCash(cashDM);
        c.musterCashUsed += 1;
      } else {
        c.musterOutBenefit(benefitsDM);
      }
    } catch (err) {
      // Benefit-table cells can resolve to a cascade (Blade/Gun) which
      // throws ChoicePendingError in interactive mode. Commit the clone
      // with the queued cascade choice in pendingChoices so the UI
      // surfaces it. Don't decrement musterRolls — the choice resolution
      // will complete the roll via resolvePending.
      if (!(err instanceof ChoicePendingError)) throw err;
      commit(c, "muster");
      return;
    }
    c.musterRolls -= 1;

    if (c.musterRolls === 0) {
      c.musterOutPay();
      c.log(ev.endGeneration("mustered"));
      commit(c, "end");
    } else if (c.musterCashUsed >= maxCashRolls(c)) {
      commit(c, "muster_no_cash");
    } else {
      commit(c, "muster");
    }
  };

  const toggleVerbose = (v: boolean) => {
    setVerbose(v);
    const prev = characterRef.current;
    if (prev) {
      const c = cloneCharacter(prev);
      c.showHistory = v ? "verbose" : "simple";
      characterRef.current = c;
      setCharacter(c);
    }
  };

  const reset = () => {
    characterRef.current = null;
    setCharacter(null);
    setPhase("start");
  };

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        verbose={verbose}
        onToggleVerbose={toggleVerbose}
        editionLabel={
          listEditions().find(
            (e) => e.id === (character?.editionId ?? edition),
          )?.displayName ?? edition
        }
      />

      <Stepper phase={phase} character={character} />

      <div
        className={
          character
            ? "grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]"
            : "grid gap-6"
        }
      >
        {character && (
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <CharacterSummary character={character} />
          </aside>
        )}

        <section className="flex flex-col gap-6">
          {character && character.pendingChoices.length > 0 && (
            <PendingChoicesPanel
              character={character}
              onResolve={resolvePending}
            />
          )}

          {phase === "start" && (
            <StartPhase
              onStart={startCareer}
              interactiveMode={interactiveMode}
              setInteractiveMode={setInteractiveMode}
              edition={edition}
              setEdition={setEdition}
              useAcg={useAcg}
              setUseAcg={setUseAcg}
              acgPathway={acgPathway}
              setAcgPathway={setAcgPathway}
            />
          )}

          {phase === "pre_career" && character && (
            <PreCareerPhase
              character={character}
              onApply={applyPreCareer}
            />
          )}

          {phase === "acg_enlist" && character && (
            <AcgEnlistPhase
              character={character}
              edition={edition}
              acgPathway={acgPathway}
              acgService={acgService}
              setAcgService={setAcgService}
              acgCombatArm={acgCombatArm}
              setAcgCombatArm={setAcgCombatArm}
              acgFleet={acgFleet}
              setAcgFleet={setAcgFleet}
              acgSubsectorTech={acgSubsectorTech}
              setAcgSubsectorTech={setAcgSubsectorTech}
              acgDivision={acgDivision}
              setAcgDivision={setAcgDivision}
              acgLineType={acgLineType}
              setAcgLineType={setAcgLineType}
              acgMerchantAcademy={acgMerchantAcademy}
              setAcgMerchantAcademy={setAcgMerchantAcademy}
              onEnlist={enlist}
            />
          )}

          {phase === "career" && character && (
            <CareerPhase
              character={character}
              preferredService={preferredService}
              setPreferredService={setPreferredService}
              onEnlist={enlist}
            />
          )}

          {phase === "term" && character && (
            <TermPhase
              character={character}
              onRunTerm={runTerm}
              onMusterOut={attemptMusterOut}
              onToggleAnagathics={(next) => {
                const prev = characterRef.current;
                if (!prev) return;
                const c = cloneCharacter(prev);
                c.anagathicsStandingOrder = next;
                commit(c, "term");
              }}
            />
          )}

          {(phase === "skill_basic" || phase === "skill_adv") && character && (
            <SkillPhase
              character={character}
              phase={phase}
              onPick={pickSkill}
            />
          )}

          {(phase === "muster" || phase === "muster_no_cash") && character && (
            <MusterPhase
              character={character}
              phase={phase}
              onChoose={musterChoice}
            />
          )}

          {phase === "end" && character && (
            <EndPhase
              character={character}
              onRestart={reset}
              onDownloadPdf={() => downloadCharacterSheetPdf(character)}
            />
          )}
        </section>
      </div>

      {character && character.history.length > 0 && (
        <HistoryPanel character={character} />
      )}

      <PageFooter />
    </main>
  );
}

function PageFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-4 space-y-2 border-t border-zinc-200 pt-5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
      <p>
        Inspired by{" "}
        <a
          className="underline decoration-zinc-400 underline-offset-2 hover:no-underline dark:decoration-zinc-600"
          href="https://github.com/pgorman/travellercharactergenerator"
          target="_blank"
          rel="noopener noreferrer"
        >
          Paul Gorman&apos;s
        </a>{" "}
        original JS generator (2015). Rules data derived from{" "}
        <em>The Traveller Book</em> (1981), <em>Citizens of the Imperium</em>{" "}
        (CT Supplement 4), and the <em>MegaTraveller Players&apos; Manual</em>{" "}
        (1987).
      </p>
      <p>
        <em>Traveller</em> is a trademark of Far Future Enterprises. The
        rulebook content is © Game Designers&apos; Workshop / Marc Miller;
        this generator is a fan tool and is not affiliated with or endorsed by
        the rights holders.
      </p>
      <p>Generator code © {year} — released under the MIT License.</p>
    </footer>
  );
}

// ---------- shared UI ----------

const CARD =
  "rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950";
const SECTION_LABEL =
  "text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400";
const SELECT_CLASS =
  "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-semibold text-zinc-700 dark:text-zinc-300">
        {label}
      </span>
      {children}
      {hint && (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>
      )}
    </label>
  );
}

function FormSelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={SELECT_CLASS}
    >
      {children}
    </select>
  );
}

function PageHeader({
  verbose,
  onToggleVerbose,
  editionLabel,
}: {
  verbose: boolean;
  onToggleVerbose: (v: boolean) => void;
  editionLabel: string;
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-zinc-200 pb-5 dark:border-zinc-800">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-mono text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
            Traveller Character Generator
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Edition: <span className="font-semibold text-zinc-700 dark:text-zinc-200">{editionLabel}</span>
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={verbose}
            onChange={(e) => onToggleVerbose(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300"
          />
          Verbose history
        </label>
      </div>
    </header>
  );
}

interface StepperStep {
  id: string;
  label: string;
  hint: string;
  phases: Phase[];
}

const STEPPER_STEPS_BASIC: StepperStep[] = [
  { id: "roll", label: "Roll", hint: "Attributes & edition", phases: ["start"] },
  { id: "enlist", label: "Enlist", hint: "Service & draft", phases: ["career"] },
  { id: "serve", label: "Serve", hint: "Terms of duty", phases: ["term", "skill_basic", "skill_adv"] },
  { id: "muster", label: "Muster", hint: "Cash & benefits", phases: ["muster", "muster_no_cash"] },
  { id: "done", label: "Done", hint: "Character sheet", phases: ["end"] },
];

const STEPPER_STEPS_ACG: StepperStep[] = [
  { id: "roll", label: "Roll", hint: "Attributes & edition", phases: ["start"] },
  { id: "pre", label: "Pre-Career", hint: "College & academies", phases: ["pre_career"] },
  { id: "enlist", label: "Enlist", hint: "Pathway & branch", phases: ["acg_enlist", "career"] },
  { id: "serve", label: "Serve", hint: "Annual cycle", phases: ["term", "skill_basic", "skill_adv"] },
  { id: "muster", label: "Muster", hint: "Cash & benefits", phases: ["muster", "muster_no_cash"] },
  { id: "done", label: "Done", hint: "Character sheet", phases: ["end"] },
];

function activityFor(phase: Phase, character: Character | null): string {
  if (phase === "start") return "Configure your character";
  if (phase === "pre_career") return "Optional college / academy";
  if (phase === "acg_enlist") return "Configure pathway & enlist";
  if (phase === "career") return character?.useAcg ? "Choose pathway" : "Choose service";
  if (phase === "term") {
    const termNum = (character?.terms ?? 0) + 1;
    return `Term ${termNum}${character?.mandatoryReenlistment ? " (mandatory reenlist)" : ""}`;
  }
  if (phase === "skill_basic") return "Pick a skill (basic tables)";
  if (phase === "skill_adv") return "Pick a skill (advanced tables)";
  if (phase === "muster") {
    const left = character?.musterRolls ?? 0;
    return left > 0 ? `${left} muster roll${left === 1 ? "" : "s"} remaining` : "Mustering out";
  }
  if (phase === "muster_no_cash") return "Benefits only — cash limit reached";
  if (phase === "end") return character?.deceased ? "Character died" : "Generation complete";
  return "";
}

function Stepper({ phase, character }: { phase: Phase; character: Character | null }) {
  const useAcgStepper = character?.useAcg ?? false;
  const steps = useAcgStepper ? STEPPER_STEPS_ACG : STEPPER_STEPS_BASIC;
  const currentIdx = steps.findIndex((s) => s.phases.includes(phase));
  const activity = activityFor(phase, character);
  const progress = currentIdx < 0 ? 0 : ((currentIdx) / (steps.length - 1)) * 100;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-3 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:px-4">
      <ol className="flex items-stretch gap-1 overflow-x-auto sm:gap-2">
        {steps.map((step, i) => {
          const state =
            i < currentIdx ? "done" : i === currentIdx ? "active" : "pending";
          return (
            <li
              key={step.id}
              aria-current={state === "active" ? "step" : undefined}
              className="flex min-w-[5rem] flex-1 flex-col items-center text-center sm:min-w-[7rem]"
            >
              <div className="flex w-full items-center">
                {i > 0 && (
                  <span
                    className={[
                      "h-0.5 flex-1 rounded-full transition-colors",
                      state === "pending"
                        ? "bg-zinc-200 dark:bg-zinc-800"
                        : "bg-emerald-500",
                    ].join(" ")}
                    aria-hidden
                  />
                )}
                <span
                  className={[
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all",
                    state === "done"
                      ? "bg-emerald-600 text-white shadow-sm shadow-emerald-600/40"
                      : state === "active"
                        ? "scale-110 bg-zinc-900 text-white shadow-md ring-4 ring-emerald-200 dark:bg-zinc-100 dark:text-zinc-900 dark:ring-emerald-900"
                        : "border border-zinc-200 bg-white text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500",
                  ].join(" ")}
                >
                  {state === "done" ? "✓" : i + 1}
                </span>
                {i < steps.length - 1 && (
                  <span
                    className={[
                      "h-0.5 flex-1 rounded-full transition-colors",
                      i < currentIdx
                        ? "bg-emerald-500"
                        : "bg-zinc-200 dark:bg-zinc-800",
                    ].join(" ")}
                    aria-hidden
                  />
                )}
              </div>
              <div className="mt-1.5">
                <div
                  className={[
                    "text-xs font-semibold sm:text-sm",
                    state === "active"
                      ? "text-zinc-900 dark:text-zinc-50"
                      : state === "done"
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-zinc-400 dark:text-zinc-500",
                  ].join(" ")}
                >
                  {step.label}
                </div>
                <div
                  className={[
                    "hidden text-[10px] uppercase tracking-wider sm:block",
                    state === "active"
                      ? "text-zinc-500 dark:text-zinc-400"
                      : "text-zinc-300 dark:text-zinc-600",
                  ].join(" ")}
                >
                  {step.hint}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {/* Progress bar + current activity */}
      <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(4, progress))}%` }}
          />
        </div>
        {activity && (
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
            <span className="font-semibold text-zinc-700 dark:text-zinc-200">
              Current step:
            </span>{" "}
            {activity}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------- character summary ----------

const ATTR_LABELS: { key: AttributeKey; short: string }[] = [
  { key: "strength", short: "Str" },
  { key: "dexterity", short: "Dex" },
  { key: "endurance", short: "End" },
  { key: "intelligence", short: "Int" },
  { key: "education", short: "Edu" },
  { key: "social", short: "Soc" },
];

function CharacterSummary({ character }: { character: Character }) {
  const def = getEditionServices(character.editionId)[character.service];
  const rankText = def?.ranks[character.rank] || "";
  const titleText =
    character.attributes.social > 10 ? character.getNobleTitle() : "";
  const memberText =
    !def || character.service === "other" ? "" : def.memberName;
  const subtitleParts = [memberText, rankText, titleText].filter(Boolean);

  return (
    <div className={CARD + " space-y-4"}>
      <div>
        <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {character.deceased && (
            <span className="text-amber-700" aria-label="deceased">† </span>
          )}
          {character.name}
        </div>
        {subtitleParts.length > 0 && (
          <div className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
            {subtitleParts.join(" · ")}
          </div>
        )}
      </div>

      <div>
        <div className={SECTION_LABEL}>UPP</div>
        <div className="mt-2 grid grid-cols-6 gap-1 text-center">
          {ATTR_LABELS.map(({ key, short }) => (
            <div key={key}>
              <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {short}
              </div>
              <div className="rounded-md bg-zinc-50 py-1 font-mono text-base font-semibold text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
                {extendedHex(character.attributes[key])}
              </div>
            </div>
          ))}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Field label="Service" value={def?.serviceName ?? ""} />
        <Field label="Age" value={String(character.age)} />
        <Field label="Terms" value={String(character.terms)} />
        <Field
          label="Credits"
          value={
            character.deceased ? "—" : `Cr${numCommaSep(character.credits)}`
          }
        />
      </dl>

      <div>
        <div className={SECTION_LABEL}>Skills</div>
        {character.skills.length === 0 ? (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">—</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-1">
            {[...character.skills]
              .sort((a, b) => {
                if (b[1] !== a[1]) return b[1] - a[1];
                return a[0].localeCompare(b[0]);
              })
              .map(([n, l]) => (
                <li
                  key={n}
                  className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-xs text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
                >
                  {n}-{l}
                </li>
              ))}
          </ul>
        )}
      </div>

      <div>
        <div className={SECTION_LABEL}>Benefits</div>
        {character.benefits.length === 0 ? (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">—</p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-sm text-zinc-700 dark:text-zinc-300">
            {aggregateBenefits(character).map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className={SECTION_LABEL}>{label}</dt>
      <dd className="font-mono text-sm text-zinc-900 dark:text-zinc-100">
        {value}
      </dd>
    </>
  );
}

// ---------- phase components ----------

function PhaseCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={CARD + " space-y-4"}>
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

function StartPhase({
  onStart,
  interactiveMode,
  setInteractiveMode,
  edition,
  setEdition,
  useAcg,
  setUseAcg,
  acgPathway,
  setAcgPathway,
}: {
  onStart: () => void;
  interactiveMode: boolean;
  setInteractiveMode: (v: boolean) => void;
  edition: string;
  setEdition: (v: string) => void;
  useAcg: boolean;
  setUseAcg: (v: boolean) => void;
  acgPathway: string;
  setAcgPathway: (v: string) => void;
}) {
  const editions = listEditions();
  const selected = editions.find((e) => e.id === edition);
  const hasAcg = editionHasAcg(edition);
  const acgPathways = hasAcg ? listAcgPathways(edition) : [];

  return (
    <div className="space-y-6">
      {/* Step 1: Edition selection — the most impactful choice, front and center */}
      <div className={CARD + " space-y-4"}>
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            1. Choose an edition
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Each edition has its own services, skills, and lifecycle. You can
            generate one character per edition; switching here resets the form.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {editions.map((e) => (
            <EditionCard
              key={e.id}
              meta={e}
              selected={e.id === edition}
              onSelect={() => {
                if (e.status === "data-only") return;
                setEdition(e.id);
                // Reset ACG when switching to a non-ACG edition.
                if (!editionHasAcg(e.id)) {
                  setUseAcg(false);
                  setAcgPathway("");
                }
              }}
            />
          ))}
        </div>
      </div>

      {/* Step 2: Edition-aware workflow preview + options */}
      <div className={CARD + " space-y-5"}>
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            2. Workflow & options
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Two dice rolled six times produce your Universal Personality
            Profile, then the selected edition&apos;s lifecycle runs.
          </p>
        </div>

        <EditionWorkflow editionId={edition} useAcg={useAcg && hasAcg} />

        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={interactiveMode && selected?.supportsInteractive === true}
              disabled={selected?.supportsInteractive !== true}
              onChange={(e) => setInteractiveMode(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span
                className={
                  "font-semibold " +
                  (selected?.supportsInteractive
                    ? "text-zinc-700 dark:text-zinc-300"
                    : "text-zinc-400 dark:text-zinc-600")
                }
              >
                Interactive choices{" "}
                {selected?.supportsInteractive
                  ? ""
                  : "(unsupported in this edition)"}
              </span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                {selected?.supportsInteractive
                  ? "Pause for player decisions — which blade or gun a weapon benefit becomes, which specific item a cascade resolves to, etc. Off = the original auto-everything flow."
                  : "Classic Traveller chargen runs procedurally per the rulebook. Only MegaTraveller opts into interactive choices today."}
              </span>
            </span>
          </label>

          {hasAcg && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={useAcg}
                onChange={(e) => {
                  setUseAcg(e.target.checked);
                  if (e.target.checked && !acgPathway && acgPathways[0]) {
                    setAcgPathway(acgPathways[0]);
                  }
                }}
                className="mt-0.5"
              />
              <span>
                <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                  Use Advanced Character Generation
                </span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                  Per-year assignment cycle with branch / MOS rolls,
                  specialist schools, command duty, brownie points, and
                  decorations. (PM pp. 44-65.)
                </span>
              </span>
            </label>
          )}
        </div>
      </div>

      {/* Step 3: ACG configuration — two-column on md+ when enabled */}
      {hasAcg && useAcg && (
        <div className={CARD + " space-y-4"}>
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              3. Advanced Character Generation
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              ACG is the optional rules-heavy chargen system in MT (PM
              pp. 44-65). Each pathway is its own career book — Mercenary
              (Army/Marines), Navy, Scout, or Merchant Prince — with its
              own per-year assignment cycle. Pick a pathway here; you&apos;ll
              configure the starting branch / role at enlistment, after
              optional pre-career.
            </p>
          </div>

          <FormField
            label="Pathway"
            hint="Which ACG career book to follow. Each has its own enlistment table, assignments, schools, and ranks."
          >
            <FormSelect value={acgPathway} onChange={setAcgPathway}>
              <option value="" disabled>
                Select a pathway…
              </option>
              {acgPathways.map((p) => (
                <option key={p} value={p}>
                  {p === "merchantPrince"
                    ? "Merchant Prince"
                    : p.charAt(0).toUpperCase() + p.slice(1)}
                </option>
              ))}
            </FormSelect>
          </FormField>
        </div>
      )}

      <div className="flex justify-end">
        <PrimaryButton
          onClick={onStart}
          disabled={useAcg && hasAcg && !acgPathway}
        >
          Roll attributes &amp; begin →
        </PrimaryButton>
      </div>
    </div>
  );
}

// ---------- edition picker ----------

function EditionCard({
  meta,
  selected,
  onSelect,
}: {
  meta: ReturnType<typeof listEditions>[number];
  selected: boolean;
  onSelect: () => void;
}) {
  const dataOnly = meta.status === "data-only";
  const summary = editionSummary(meta.id);
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={dataOnly}
      aria-pressed={selected}
      className={[
        "group relative flex flex-col gap-2 rounded-lg border p-4 text-left transition",
        "focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-950",
        selected
          ? "border-emerald-500 bg-emerald-50 shadow-md ring-2 ring-emerald-500/30 dark:border-emerald-400 dark:bg-emerald-950/40"
          : dataOnly
            ? "cursor-not-allowed border-zinc-200 bg-zinc-50 opacity-60 dark:border-zinc-800 dark:bg-zinc-900"
            : "border-zinc-200 bg-white hover:border-emerald-400 hover:bg-emerald-50/50 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-emerald-600 dark:hover:bg-emerald-950/20",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-sm font-bold uppercase tracking-wider text-zinc-900 dark:text-zinc-50">
            {meta.name}
          </div>
          {meta.year && (
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              {meta.year}
            </div>
          )}
        </div>
        {dataOnly ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            Data only
          </span>
        ) : selected ? (
          <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
            Selected
          </span>
        ) : (
          <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 group-hover:border-emerald-400 group-hover:text-emerald-700 dark:border-zinc-700 dark:text-zinc-400">
            Available
          </span>
        )}
      </div>
      <div className="text-xs text-zinc-600 dark:text-zinc-400">
        Based on:{" "}
        <span className="italic">{meta.rulebooks.join(", ")}</span>
      </div>
      <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{summary}</p>
      {dataOnly && (
        <p className="text-xs italic text-amber-700 dark:text-amber-400">
          JSON data extracted, engine not yet implemented.
        </p>
      )}
    </button>
  );
}

function editionSummary(id: string): string {
  if (id === "ct-classic") {
    return "Classic Traveller: six services (Navy/Marines/Army/Scouts/Merchants/Other) plus Citizens of the Imperium expansions. Roll, enlist, run four-year terms, muster out. The original 1981 chargen.";
  }
  if (id === "mt-megatraveller") {
    return "MegaTraveller adds homeworld generation, eighteen services (incl. Belters, Doctors, Pirates, Nobles), and an Advanced Character Generation system with brownie points, decorations, court martial, and per-year assignment cycles across four pathways.";
  }
  return "Edition data extracted from its rulebook. See data/editions for details.";
}

function EditionWorkflow({
  editionId,
  useAcg,
}: {
  editionId: string;
  useAcg: boolean;
}) {
  const steps = workflowStepsFor(editionId, useAcg);
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900/50">
      <div className={SECTION_LABEL}>What happens next</div>
      <ol className="mt-2 space-y-1.5 text-sm text-zinc-700 dark:text-zinc-300">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 font-mono text-[10px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function workflowStepsFor(editionId: string, useAcg: boolean): string[] {
  const ct = editionId === "ct-classic";
  const mt = editionId === "mt-megatraveller";
  const steps: string[] = [
    "Roll 2D for each of the six characteristics (Str, Dex, End, Int, Edu, Soc).",
  ];
  if (mt) {
    steps.push("Roll a homeworld (PM p. 12) — its tech / atmosphere / law constrain which careers you may enlist in.");
  }
  if (mt && useAcg) {
    steps.push("Optional pre-career: college, service academy, medical or flight school. Honors graduates earn brownie points and special skills.");
    steps.push("Pick a pathway (Mercenary / Navy / Scout / Merchant Prince) and roll for enlistment.");
    steps.push("Each four-year term cycles annually: assignment roll, survival, decoration, promotion, skills. Schools, command duty, court martial, brownie point spend all in play.");
  } else {
    steps.push("Choose a service or take random; the enlistment roll determines acceptance vs. draft.");
    steps.push(
      ct
        ? "Each four-year term: survival, commission and promotion, skills, then aging from age 34+. Reenlistment at term end."
        : "Each four-year term: survival, position/commission, promotion, special duty, skills, aging from age 34+. Reenlistment at term end.",
    );
  }
  steps.push("Muster out: cash and material benefits (passages, weapons, ships, TAS) determined by rank, terms, and rolls.");
  return steps;
}

function PendingChoicesPanel({
  character,
  onResolve,
}: {
  character: Character;
  onResolve: (choiceId: string, optionIdx: number) => void;
}) {
  const first = character.pendingChoices[0];
  if (!first) return null;
  const preferred = first.preferred ?? [];
  const isPreferred = (opt: string) => preferred.includes(opt);

  return (
    <PhaseCard
      title="Player choice"
      subtitle={first.label}
    >
      <div className="flex flex-wrap gap-2">
        {first.options.map((opt, i) => (
          <button
            key={`${first.id}-${i}`}
            type="button"
            onClick={() => onResolve(first.id, i)}
            className={
              "rounded-md border px-3 py-2 text-sm transition " +
              (isPreferred(opt)
                ? "border-amber-400 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950 dark:hover:bg-amber-900"
                : "border-zinc-300 bg-white hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800")
            }
          >
            {opt}
          </button>
        ))}
      </div>
      {preferred.length > 0 && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Highlighted: weapons you already have skill in. Picking one of these
          stacks the new level onto the existing skill.
        </p>
      )}
      {character.pendingChoices.length > 1 && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {character.pendingChoices.length - 1} more choice
          {character.pendingChoices.length - 1 === 1 ? "" : "s"} queued after
          this one.
        </p>
      )}
    </PhaseCard>
  );
}

type PreCareerOption =
  | "college" | "navalAcademy" | "militaryAcademy" | "merchantAcademy"
  | "medicalSchool" | "flightSchool";

function PreCareerPhase({
  character,
  onApply,
}: {
  character: Character;
  onApply: (opt: PreCareerOption | "skip") => void;
}) {
  const attended = character.acgState?.schoolsAttended ?? [];
  const attempted = character.acgState?.schoolsAttempted ?? [];
  const honors = character.acgState?.honorsGraduations ?? [];
  const pathway = character.acgPathway ?? "";
  const has = (k: string) => attended.includes(k);
  const tried = (k: string) => attempted.includes(k);
  const hasHonors = (k: string) => honors.includes(k);
  const navalAcademyGraduated = has("navalAcademy");
  const collegeHonorsCommissioned =
    hasHonors("college") && character.acgState?.preCareerCommission === true;
  // PM p. 47 honors gates:
  //   Medical School: honors from college OR Naval Academy OR Military Academy.
  //   Flight School: commissioned college honors graduate, OR any Naval
  //     Academy graduate, OR commissioned Merchant Academy graduate.
  const medAvailable = !tried("medicalSchool") &&
    (hasHonors("college") || hasHonors("navalAcademy") || hasHonors("militaryAcademy"));
  const flightAvailable = !tried("flightSchool") &&
    (collegeHonorsCommissioned || navalAcademyGraduated ||
     (has("merchantAcademy") && character.acgState?.preCareerCommission === true));
  // PM ACG checklists (one per pathway, p. 64-65) constrain which schools
  // a pathway's pre-enlistment options include:
  //   Mercenary: College, Naval Academy, Military Academy, Medical, Flight
  //   Navy:      College, Naval Academy, Medical, Flight
  //   Scout:     College, Medical, Flight (no academies)
  //   Merchant:  College, Medical, Flight (no academies)
  // Academies auto-enlist into their service, which would conflict with the
  // declared pathway — hiding them keeps the pre-career picker honest.
  const allowsNavalAcademy = pathway === "mercenary" || pathway === "navy";
  const allowsMilitaryAcademy = pathway === "mercenary";
  // Hide an option if the character can't meet its attribute eligibility
  // (e.g., Naval Academy with Soc < 8). Showing "requires Soc 8+" and then
  // doing nothing on click is worse than just not showing it.
  const eligible = (opt: PreCareerOption) => isPreCareerEligible(character, opt);
  const eid = character.editionId;
  return (
    <PhaseCard
      title="Pre-career education (optional)"
      subtitle="College, service academies, medical, and flight school. Each option ages you and may grant skills, attributes, brownie points, or auto-enlist. Academy honors graduates may chain into Medical or Flight School. Skip to proceed straight to enlistment."
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {!tried("college") && eligible("college") && (
          <PreCareerButton
            label={preCareerLabel("college", eid)}
            sub={preCareerUiSummary(eid, "college")}
            onClick={() => onApply("college")}
          />
        )}
        {allowsNavalAcademy && !tried("navalAcademy") && eligible("navalAcademy") && (
          <PreCareerButton
            label={preCareerLabel("navalAcademy", eid)}
            sub={preCareerUiSummary(eid, "navalAcademy")}
            onClick={() => onApply("navalAcademy")}
          />
        )}
        {allowsMilitaryAcademy && !tried("militaryAcademy") && eligible("militaryAcademy") && (
          <PreCareerButton
            label={preCareerLabel("militaryAcademy", eid)}
            sub={preCareerUiSummary(eid, "militaryAcademy")}
            onClick={() => onApply("militaryAcademy")}
          />
        )}
        {/* Merchant Academy is post-enlistment-only (PM p. 44: "available
            after enlistment in a Megacorporation or Sector-wide line"). The
            pre-career UI no longer offers it; attemptPreCareer enforces the
            lineType gate. */}
        {medAvailable && eligible("medicalSchool") && (
          <PreCareerButton
            label={preCareerLabel("medicalSchool", eid)}
            sub={preCareerUiSummary(eid, "medicalSchool")}
            onClick={() => onApply("medicalSchool")}
          />
        )}
        {flightAvailable && eligible("flightSchool") && (
          <PreCareerButton
            label={preCareerLabel("flightSchool", eid)}
            sub={preCareerUiSummary(eid, "flightSchool")}
            onClick={() => onApply("flightSchool")}
          />
        )}
      </div>
      <PrimaryButton onClick={() => onApply("skip")}>
        Skip pre-career → enlistment
      </PrimaryButton>
      {attended.length > 0 && (
        <div className="text-xs text-zinc-600 dark:text-zinc-400">
          Already attended: {attended.join(", ")}
        </div>
      )}
    </PhaseCard>
  );
}

function PreCareerButton({
  label, sub, onClick,
}: { label: string; sub: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md border border-zinc-300 bg-white p-3 text-left text-sm shadow-sm hover:border-emerald-500 hover:bg-emerald-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-emerald-500 dark:hover:bg-zinc-800"
    >
      <div className="font-semibold text-zinc-900 dark:text-zinc-50">{label}</div>
      <div className="text-xs text-zinc-600 dark:text-zinc-400">{sub}</div>
    </button>
  );
}

function AcgEnlistPhase({
  character,
  edition,
  acgPathway,
  acgService,
  setAcgService,
  acgCombatArm,
  setAcgCombatArm,
  acgFleet,
  setAcgFleet,
  acgSubsectorTech,
  setAcgSubsectorTech,
  acgDivision,
  setAcgDivision,
  acgLineType,
  setAcgLineType,
  acgMerchantAcademy,
  setAcgMerchantAcademy,
  onEnlist,
}: {
  character: Character;
  edition: string;
  acgPathway: string;
  acgService: "army" | "marines";
  setAcgService: (v: "army" | "marines") => void;
  acgCombatArm: string;
  setAcgCombatArm: (v: string) => void;
  acgFleet: "imperialNavy" | "reserveFleet" | "systemSquadron";
  setAcgFleet: (v: "imperialNavy" | "reserveFleet" | "systemSquadron") => void;
  acgSubsectorTech: string;
  setAcgSubsectorTech: (v: string) => void;
  acgDivision: "field" | "bureaucracy";
  setAcgDivision: (v: "field" | "bureaucracy") => void;
  acgLineType: string;
  setAcgLineType: (v: string) => void;
  acgMerchantAcademy: boolean;
  setAcgMerchantAcademy: (v: boolean) => void;
  onEnlist: () => void;
}) {
  // Pre-career may have locked the branch (Military Academy honors → army or
  // marines; OTC → branch chosen during OTC). When set, surface it as the
  // default and note that it came from pre-career.
  const preCareerBranch = character.acgState?.preCareerBranch ?? null;
  const preCareerCommissioned =
    character.acgState?.preCareerCommission === true;
  const pathwayLabel =
    acgPathway === "merchantPrince"
      ? "Merchant Prince"
      : acgPathway.charAt(0).toUpperCase() + acgPathway.slice(1);

  return (
    <PhaseCard
      title={`Configure ${pathwayLabel} enlistment`}
      subtitle={
        preCareerCommissioned
          ? "Pre-career commissioned you — pick remaining sub-options and enlist."
          : "Per the PM ACG checklist, configure your starting branch / role for this pathway, then enlist."
      }
    >
      <div className="space-y-4">
        {acgPathway === "mercenary" && (
          <>
            <FormField
              label="Service"
              hint={
                preCareerBranch
                  ? `Pre-career fixed this to ${preCareerBranch === "army" ? "Army" : "Marines"}.`
                  : "Army (5+ to enlist, ground operations) or Marines (9+ to enlist, ship-board assignments available)."
              }
            >
              <FormSelect
                value={acgService}
                onChange={(v) => setAcgService(v as "army" | "marines")}
              >
                <option value="army">Army</option>
                <option value="marines">Marines</option>
              </FormSelect>
            </FormField>
            <FormField
              label="Combat arm"
              hint="Commando is restricted to Military Academy honors graduates."
            >
              <FormSelect value={acgCombatArm} onChange={setAcgCombatArm}>
                {mercenaryNonCommandoArms(edition).map((arm) => (
                  <option key={arm} value={arm}>
                    {arm}
                  </option>
                ))}
              </FormSelect>
            </FormField>
          </>
        )}

        {acgPathway === "navy" && (
          <>
            <FormField label="Fleet">
              <FormSelect
                value={acgFleet}
                onChange={(v) => setAcgFleet(v as typeof acgFleet)}
              >
                <option value="imperialNavy">
                  Imperial Navy (8+ to enlist)
                </option>
                <option value="reserveFleet">
                  Reserve Fleet (7+ to enlist)
                </option>
                <option value="systemSquadron">
                  System Squadron (6+, requires Early Stellar+ homeworld)
                </option>
              </FormSelect>
            </FormField>
            <FormField
              label="Subsector tech code"
              hint="PM p. 52 step 1C: subsector capital's tech. Default falls back to your homeworld tech, clamped to Early Stellar+."
            >
              <FormSelect
                value={acgSubsectorTech}
                onChange={setAcgSubsectorTech}
              >
                <option value="">
                  — default (homeworld tech, clamped to Early Stellar+)
                </option>
                <option value="Early Stellar">Early Stellar</option>
                <option value="Avg Stellar">Avg Stellar</option>
                <option value="High Stellar">High Stellar</option>
              </FormSelect>
            </FormField>
          </>
        )}

        {acgPathway === "scout" && (
          <FormField label="Division">
            <FormSelect
              value={acgDivision}
              onChange={(v) =>
                setAcgDivision(v as "field" | "bureaucracy")
              }
            >
              <option value="field">
                Field (Survey, Communications, Exploration)
              </option>
              <option value="bureaucracy">
                Bureaucracy (Technical, Operations, Administration, Detached Duty)
              </option>
            </FormSelect>
          </FormField>
        )}

        {acgPathway === "merchantPrince" && (
          <>
            <FormField label="Line type">
              <FormSelect value={acgLineType} onChange={setAcgLineType}>
                <option value="Megacorp">Megacorp (9+, Class B+)</option>
                <option value="Sector-wide">Sector-wide (8+, Class C+)</option>
                <option value="Subsector-wide">Subsector-wide (7+, Class D+)</option>
                <option value="Interface">Interface (7+)</option>
                <option value="Fledgling">Fledgling (7+)</option>
                <option value="Free Trader">Free Trader (7+)</option>
              </FormSelect>
            </FormField>
            {(acgLineType === "Megacorp" || acgLineType === "Sector-wide") && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={acgMerchantAcademy}
                  onChange={(e) => setAcgMerchantAcademy(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <strong className="font-semibold">
                    Apply for Merchant Academy.
                  </strong>{" "}
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    PM p. 47: available only after enlistment in
                    Megacorporation or Sector-wide lines. Honors graduates
                    pick their department and start at rank O1.
                  </span>
                </span>
              </label>
            )}
          </>
        )}
      </div>

      <PrimaryButton onClick={onEnlist}>Enlist →</PrimaryButton>
    </PhaseCard>
  );
}

function CareerPhase({
  character,
  preferredService,
  setPreferredService,
  onEnlist,
}: {
  character: Character;
  preferredService: ServiceKey | "random";
  setPreferredService: (v: ServiceKey | "random") => void;
  onEnlist: () => void;
}) {
  const targetSvc = preferredService === "random" ? null : preferredService;
  const def = targetSvc ? getEditionServices(character.editionId)[targetSvc] ?? null : null;
  const dm = def ? def.enlistmentDM(character.attributes) : 0;
  const target = def ? def.enlistmentThrow : 0;
  // Only services in the *character's* edition are valid picks. The cross-
  // edition union was leaking CT-only services into MT pickers and vice
  // versa, causing edition-specific service lookups to throw later.
  const enlistableForEdition = getEnlistableServices(character.editionId);

  return (
    <PhaseCard
      title="Choose a service to attempt enlistment"
      subtitle="If your enlistment roll fails, you'll be drafted into one of: Navy, Marines, Army, Scouts, Sailors, or Flyers. Social 10+ characters are automatically enrolled into the Nobility if you leave this on Random."
    >
      <label className="flex flex-col gap-1.5">
        <span className={SECTION_LABEL}>Preferred service</span>
        <select
          value={preferredService}
          onChange={(e) =>
            setPreferredService(e.target.value as ServiceKey | "random")
          }
          className="max-w-xs rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >
          <option value="random">Random</option>
          {enlistableForEdition.map((k) => (
            <option key={k} value={k}>
              {serviceLabel(k, character.editionId)}
            </option>
          ))}
        </select>
      </label>

      {def && (
        <div className="rounded-md bg-zinc-50 p-3 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          <div className="font-mono">
            Enlistment throw {target}+ on 2d6
            {dm !== 0
              ? `, ${dm >= 0 ? "+" : ""}${dm} DM from your attributes`
              : ", no DMs"}
            .
          </div>
        </div>
      )}

      <PrimaryButton onClick={onEnlist}>Attempt enlistment →</PrimaryButton>
    </PhaseCard>
  );
}

function TermPhase({
  character,
  onRunTerm,
  onMusterOut,
  onToggleAnagathics,
}: {
  character: Character;
  onRunTerm: () => void;
  onMusterOut: () => void;
  onToggleAnagathics: (next: boolean) => void;
}) {
  const termNum = character.terms + 1;
  const nextAge = character.age + 4;
  const def = getEditionServices(character.editionId)[character.service]!;

  const canMusterOut =
    character.terms >= 1 && !character.mandatoryReenlistment;

  // Anagathics eligibility: MT only (rules.skillCap is a proxy for the MT
  // ruleset), age 30+ at end of third term. Visible only when relevant.
  const editionData = getEdition(character.editionId).data;
  const hasMtRules =
    Boolean((editionData.rules as { skillCap?: unknown })?.skillCap);
  const anagathicsEligible =
    hasMtRules && nextAge >= 30 && character.terms >= 3;

  // MT (PM p. 16) vs CT (TTB p. 11) checklist + survival-failure behaviour
  // differ — read directly from the edition rules so the UI doesn't
  // overstate the mechanics.
  const survivalRules = (editionData.rules as {
    survival?: { onFailure?: "death" | "shortTerm" | "musterOut" };
  } | undefined)?.survival;
  const failureIsDeath = (survivalRules?.onFailure ?? "death") === "death";
  const checklist = hasMtRules
    ? "Survival, position/commission and promotion, special duty, skills, then aging from age 34. End-of-term: reenlistment, mustering out."
    : "Survival, commission, promotion, skills, then aging from age 34. End-of-term: reenlistment, mustering out.";

  return (
    <PhaseCard
      title={`Term ${termNum} of service`}
      subtitle={`You'll be ${nextAge} years old after this term. Each term is 4 years. ${checklist}`}
    >
      {character.mandatoryReenlistment && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <strong className="font-semibold">Mandatory reenlistment.</strong>{" "}
          The previous reenlistment roll was a 12 — per the rules the
          character must serve this term regardless of personal preference.
          Voluntary muster-out is unavailable until this term completes.
        </div>
      )}

      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Stat
          label="Survival"
          value={`${def.survivalThrow}+`}
          hint={failureIsDeath ? "2d6, fail → death" : "2d6, fail → short term (2 years), muster out"}
        />
        {def.commissionThrow !== undefined && (
          <Stat
            label={character.commissioned ? "Promotion" : "Commission"}
            value={`${character.commissioned ? (def.promotionThrow ?? "—") : def.commissionThrow}+`}
            hint={
              character.commissioned
                ? "2d6, success → +1 rank"
                : "2d6, success → rank 1"
            }
          />
        )}
        <Stat
          label="Reenlist"
          value={`${def.reenlistThrow}+`}
          hint={
            def.inverseReenlist
              ? "must throw to leave"
              : "2d6, fail → must leave"
          }
        />
      </dl>

      {anagathicsEligible && (
        <div className="rounded-md border border-slate-300 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={character.anagathicsStandingOrder}
              onChange={(e) => onToggleAnagathics(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <strong className="font-semibold">Attempt anagathics this term.</strong>{" "}
              -1 survival DM ({character.service === "nobles" ? "-2 for nobles" : ""}),
              muster benefit roll forfeited for the term, permanent cap of 2 cash
              rolls once ever taken. On a successful availability roll the
              character auto-saves 2 aging characteristics. If the first
              availability roll fails, an extra survival roll gates one retry —
              failing that survival forces a short-term muster-out. PM p. 15.
            </span>
          </label>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <PrimaryButton onClick={onRunTerm}>Run term →</PrimaryButton>
        {canMusterOut && (
          <SecondaryButton
            onClick={onMusterOut}
            variant="amber"
            title="Roll 2d6; a 12 forces another mandatory term."
          >
            Muster out instead
          </SecondaryButton>
        )}
      </div>
    </PhaseCard>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className={SECTION_LABEL}>{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {hint}
        </div>
      )}
    </div>
  );
}

function SkillPhase({
  character,
  phase,
  onPick,
}: {
  character: Character;
  phase: "skill_basic" | "skill_adv";
  onPick: (table: number) => void;
}) {
  const tables: { table: number; label: string; hint: string }[] = [
    {
      table: 1,
      label: "Personal Development",
      hint: "Attribute boosts, basic combat skills",
    },
    {
      table: 2,
      label: "Service Skills",
      hint: "Skills tied to this service's role",
    },
    {
      table: 3,
      label: "Advanced Education",
      hint: "Mechanical, electronic, tactics, etc.",
    },
  ];
  if (phase === "skill_adv") {
    tables.push({
      table: 4,
      label: "Advanced Education (Edu 8+)",
      hint: "Highest-tier specialist skills",
    });
  }

  return (
    <PhaseCard
      title={`Pick a skill table (${character.skillPoints} pick${character.skillPoints === 1 ? "" : "s"} left)`}
      subtitle="One die determines the specific skill from the chosen table. Random rolls a table for you (excluding table 4 if Edu < 8)."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {tables.map(({ table, label, hint }) => (
          <button
            key={table}
            type="button"
            onClick={() => onPick(table)}
            className="group rounded-md border border-zinc-200 bg-white p-3 text-left transition hover:border-indigo-400 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-indigo-500"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium text-zinc-900 dark:text-zinc-100">
                Table {table}: {label}
              </div>
              <span className="text-indigo-700 opacity-0 transition group-hover:opacity-100 dark:text-indigo-400">
                →
              </span>
            </div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {hint}
            </div>
          </button>
        ))}
      </div>
      <div className="pt-1">
        <SecondaryButton onClick={() => onPick(0)} variant="zinc">
          Pick a random table for me
        </SecondaryButton>
      </div>
    </PhaseCard>
  );
}

function MusterPhase({
  character,
  phase,
  onChoose,
}: {
  character: Character;
  phase: "muster" | "muster_no_cash";
  onChoose: (kind: "cash" | "benefit") => void;
}) {
  const cashCap = maxCashRolls(character);
  const cashLeft = cashCap - character.musterCashUsed;
  const cashDM = cashDmFor(character);
  const benefitDM = benefitDmFor(character);

  return (
    <PhaseCard
      title={`Muster out — ${character.musterRolls} roll${character.musterRolls === 1 ? "" : "s"} left`}
      subtitle={`Spend each remaining roll on either cash (max ${cashCap} cash rolls) or a non-cash benefit. Gambling skill adds +1 DM on cash rolls; rank 5+ adds +1 DM on benefit rolls.`}
    >
      <dl className="grid grid-cols-3 gap-2">
        <Stat label="Rolls left" value={String(character.musterRolls)} />
        <Stat
          label="Cash rolls left"
          value={`${cashLeft} / ${cashCap}`}
          hint={cashDM ? "+1 DM (Gambling)" : undefined}
        />
        <Stat
          label="Benefit DM"
          value={benefitDM ? "+1" : "0"}
          hint={benefitDM ? "Rank 5+" : undefined}
        />
      </dl>

      <div className="flex flex-wrap gap-2 pt-1">
        {phase === "muster" && (
          <SecondaryButton
            onClick={() => onChoose("cash")}
            variant="amber-light"
          >
            Roll for cash
          </SecondaryButton>
        )}
        <SecondaryButton onClick={() => onChoose("benefit")} variant="indigo">
          Roll for benefit
        </SecondaryButton>
      </div>

      <MusterLog log={character.musterLog} />
    </PhaseCard>
  );
}

function MusterLog({ log }: { log: string[] }) {
  if (log.length === 0) return null;
  return (
    <div>
      <div className={SECTION_LABEL}>Muster-out rolls so far</div>
      <ol className="mt-2 space-y-1 text-sm">
        {log.map((entry, i) => (
          <li
            key={i}
            className="flex gap-2 rounded-md bg-zinc-50 px-2.5 py-1.5 dark:bg-zinc-900"
          >
            <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
              #{i + 1}
            </span>
            <span className="text-zinc-800 dark:text-zinc-200">{entry}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function EndPhase({
  character,
  onRestart,
  onDownloadPdf,
}: {
  character: Character;
  onRestart: () => void;
  onDownloadPdf: () => void;
}) {
  return (
    <PhaseCard
      title={
        character.deceased
          ? "Character died in service"
          : "Character generation complete"
      }
      subtitle={
        character.deceased
          ? "A new character must be generated. Survival in service is not guaranteed — that's by design."
          : "Save the character to PDF for play, or roll up another."
      }
    >
      <div className="flex flex-wrap gap-2">
        {!character.deceased && (
          <PrimaryButton variant="indigo-dark" onClick={onDownloadPdf}>
            Download character sheet (PDF)
          </PrimaryButton>
        )}
        <SecondaryButton onClick={onRestart} variant="emerald">
          Roll another
        </SecondaryButton>
      </div>

      {!character.deceased && <MusterLog log={character.musterLog} />}
    </PhaseCard>
  );
}

// ---------- buttons ----------

const BUTTON_BASE =
  "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium shadow-sm transition focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50";

function PrimaryButton({
  children,
  onClick,
  variant = "emerald",
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "emerald" | "indigo-dark";
  disabled?: boolean;
}) {
  const cls =
    variant === "indigo-dark"
      ? "bg-indigo-800 text-white hover:bg-indigo-700 focus:ring-indigo-500"
      : "bg-emerald-700 text-white hover:bg-emerald-600 focus:ring-emerald-500";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${BUTTON_BASE} ${cls}`}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
  variant = "zinc",
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "zinc" | "amber" | "amber-light" | "indigo" | "emerald";
  title?: string;
}) {
  const map: Record<string, string> = {
    zinc: "bg-zinc-700 text-white hover:bg-zinc-600 focus:ring-zinc-500",
    amber: "bg-amber-700 text-white hover:bg-amber-600 focus:ring-amber-500",
    "amber-light":
      "bg-amber-600 text-white hover:bg-amber-500 focus:ring-amber-400",
    indigo:
      "bg-indigo-700 text-white hover:bg-indigo-600 focus:ring-indigo-500",
    emerald:
      "bg-emerald-700 text-white hover:bg-emerald-600 focus:ring-emerald-500",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`${BUTTON_BASE} ${map[variant]}`}
    >
      {children}
    </button>
  );
}

// ---------- history ----------

function HistoryPanel({ character }: { character: Character }) {
  // Prefer the structured event log when present (every event is typed,
  // formatted by formatEvent, and filtered by visibility). Fall back to
  // the legacy string history for older characters / migration period.
  const events = visibleAt(
    character.events,
    character.showHistory === "debug"
      ? "debug"
      : character.showHistory === "verbose"
      ? "verbose"
      : "simple",
  );
  const lines = events.length > 0
    ? events.map((e) => formatEvent(e))
    : character.history;

  return (
    <details className={CARD}>
      <summary className="cursor-pointer select-none text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Service history
        <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">
          ({lines.length}{" "}
          {lines.length === 1 ? "entry" : "entries"})
        </span>
      </summary>
      <ol className="mt-3 max-h-80 space-y-1 overflow-y-auto pr-2 text-sm text-zinc-700 dark:text-zinc-300">
        {lines.map((line, i) => (
          <li
            key={i}
            className={[
              "font-mono",
              line.startsWith("---") || line.startsWith("===")
                ? "text-zinc-400 dark:text-zinc-600"
                : "",
            ].join(" ")}
          >
            {line}
          </li>
        ))}
      </ol>
    </details>
  );
}
