"use client";

import { useEffect, useRef, useState } from "react";
import { cloneCharacter } from "@/lib/traveller/character";
import { DEFAULT_EDITION_ID, listEditions } from "@/lib/traveller/editions";
import * as session from "@/lib/traveller/chargen/session";
import type { ServiceKey } from "@/lib/traveller/types";
import { downloadCharacterSheetPdf } from "@/lib/pdfSheet";
import { PageHeader, PageFooter } from "./components/ui";
import { Stepper } from "./components/Stepper";
import { CharacterSummary } from "./components/CharacterSummary";
import { HistoryPanel } from "./components/HistoryPanel";
import { PendingChoicesPanel } from "./components/PendingChoicesPanel";
import { StartPhase } from "./components/phases/StartPhase";
import { PreCareerPhase } from "./components/phases/PreCareerPhase";
import {
  AcgEnlistPhase, initialAcgFormState, type AcgFormState,
} from "./components/phases/AcgEnlistPhase";
import { CareerPhase } from "./components/phases/CareerPhase";
import { TermPhase } from "./components/phases/TermPhase";
import { SkillPhase } from "./components/phases/SkillPhase";
import { MusterPhase } from "./components/phases/MusterPhase";
import { EndPhase } from "./components/phases/EndPhase";
import { MongooseCareerPhase, MongooseTermPhase } from "./components/phases/MongoosePhase";

type Phase = session.ChargenPhase;

export default function Home() {
  const [snap, setSnap] = useState<session.ChargenSnapshot | null>(null);
  const [verbose, setVerbose] = useState(true);
  const [interactiveMode, setInteractiveMode] = useState(false);
  const [edition, setEdition] = useState<string>(DEFAULT_EDITION_ID);
  const [useAcg, setUseAcg] = useState(false);
  const [acgPathway, setAcgPathway] = useState<string>("");
  const [acgForm, setAcgFormState] = useState<AcgFormState>(initialAcgFormState);
  const [preferredService, setPreferredService] = useState<
    ServiceKey | "random"
  >("random");

  // Mirror the WHOLE snapshot in a ref so async handlers see the latest
  // value, not the closure-captured one — and so the frontier (the paused
  // action's re-execution base) is never dropped between actions.
  // Functional setState would be React-idiomatic but its updater re-runs
  // in dev StrictMode, which would re-roll dice.
  const snapRef = useRef<session.ChargenSnapshot | null>(null);
  useEffect(() => {
    snapRef.current = snap;
  }, [snap]);

  const character = snap?.character ?? null;
  const phase: Phase = snap?.phase ?? "start";

  const commit = (next: session.ChargenSnapshot) => {
    snapRef.current = next;
    setSnap(next);
  };

  const setAcgForm = (patch: Partial<AcgFormState>) =>
    setAcgFormState((prev) => ({ ...prev, ...patch }));

  const startCareer = () => {
    const editionMeta = listEditions().find((e) => e.id === edition);
    // Seed every run: the event-sourced resume model re-executes a paused
    // action from its cloned base, so a seeded stream makes re-runs (and
    // the whole run) deterministic and the session reproducible from its
    // seed + action log (chargen/replay).
    const seed = Math.floor(Math.random() * 0x1_0000_0000);
    commit(session.startCareer({
      edition,
      verbose,
      interactiveMode,
      supportsInteractive: editionMeta?.supportsInteractive === true,
      useAcg,
      acgPathway,
      seed,
    }));
  };

  /** Enlistment-form pre-population from a pre-career outcome (academy /
   *  OTC / medical direct commission). In interactive mode these arrive
   *  via resolvePending (the branch prompt IS the outcome), in auto mode
   *  via applyPreCareer. */
  const applyHints = (hints?: session.UiHints) => {
    if (!hints) return;
    if (hints.acgPathway) setAcgPathway(hints.acgPathway);
    if (hints.acgService) setAcgForm({ service: hints.acgService });
    if (hints.acgFleet) setAcgForm({ fleet: hints.acgFleet });
  };

  const applyPreCareer = (opt: session.PreCareerOption) => {
    const prev = snapRef.current;
    if (!prev) return;
    const result = session.applyPreCareer(prev, opt);
    commit(result.snapshot);
    if (opt === "skip") {
      setAcgForm({ service: "army", fleet: "imperialNavy" });
    }
    applyHints(result.hints);
  };

  const resolvePending = (choiceId: string, optionIdx: number) => {
    const prev = snapRef.current;
    if (!prev) return;
    const result = session.resolvePending(prev, choiceId, optionIdx);
    commit(result.snapshot);
    applyHints(result.hints);
  };

  const enlist = () => {
    const prev = snapRef.current;
    if (!prev) return;
    commit(session.enlist(prev, {
      verbose,
      preferredService,
      acgService: acgForm.service,
      acgCombatArm: acgForm.combatArm,
      acgFleet: acgForm.fleet,
      acgDivision: acgForm.division,
      acgLineType: acgForm.lineType,
      acgSubsectorTech: acgForm.subsectorTech,
      acgMerchantAcademy: acgForm.merchantAcademy,
    }));
  };

  const runTerm = () => {
    const prev = snapRef.current;
    if (!prev) return;
    commit(session.runTerm(prev));
  };

  const attemptMusterOut = () => {
    const prev = snapRef.current;
    if (!prev) return;
    commit(session.attemptMusterOut(prev));
  };

  const pickSkill = (table: number) => {
    const prev = snapRef.current;
    if (!prev) return;
    commit(session.pickSkill(prev, table));
  };

  const musterChoice = (kind: "cash" | "benefit") => {
    const prev = snapRef.current;
    if (!prev) return;
    commit(session.musterChoice(prev, kind));
  };

  const toggleVerbose = (v: boolean) => {
    setVerbose(v);
    const prev = snapRef.current;
    if (prev) commit(session.setVerbose(prev, v));
  };

  const toggleAnagathics = (next: boolean) => {
    const prev = snapRef.current;
    if (!prev) return;
    const c = cloneCharacter(prev.character);
    c.anagathicsStandingOrder = next;
    if (prev.frontier) {
      // Apply the standing order to the paused action's re-execution base
      // too — a resume re-runs from that base, and would otherwise lose it.
      const base = cloneCharacter(prev.frontier.base);
      base.anagathicsStandingOrder = next;
      commit({ ...prev, character: c, frontier: { ...prev.frontier, base } });
    } else {
      commit({ character: c, phase: prev.phase });
    }
  };

  const reset = () => {
    snapRef.current = null;
    setSnap(null);
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
          {/* Phase panels only render when no choice is pending. Each
              choice must be resolved before the player can advance —
              clicking Run term / Enlist / etc. while a prompt is queued
              would re-enter the paused step with stale defaults. */}
          {(!character || character.pendingChoices.length === 0) && (<>

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
              form={acgForm}
              setForm={setAcgForm}
              onEnlist={enlist}
            />
          )}

          {phase === "career" && character && (
            character.chargenModelId === "mongoose" ? (
              <MongooseCareerPhase
                character={character}
                onBeginCareer={enlist}
                onFinish={attemptMusterOut}
              />
            ) : (
              <CareerPhase
                character={character}
                preferredService={preferredService}
                setPreferredService={setPreferredService}
                onEnlist={enlist}
              />
            )
          )}

          {phase === "term" && character && (
            character.chargenModelId === "mongoose" ? (
              <MongooseTermPhase
                character={character}
                onRunTerm={runTerm}
                onMusterOut={attemptMusterOut}
              />
            ) : (
              <TermPhase
                character={character}
                onRunTerm={runTerm}
                onMusterOut={attemptMusterOut}
                onToggleAnagathics={toggleAnagathics}
              />
            )
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
          </>)}
        </section>
      </div>

      {character && character.history.length > 0 && (
        <HistoryPanel character={character} />
      )}

      <PageFooter />
    </main>
  );
}
