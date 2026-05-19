"use client";

import { useEffect, useRef, useState } from "react";
import { Character, cloneCharacter } from "@/lib/traveller/character";
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

type Phase = session.ChargenPhase;

export default function Home() {
  const [phase, setPhase] = useState<Phase>("start");
  const [character, setCharacter] = useState<Character | null>(null);
  const [verbose, setVerbose] = useState(true);
  const [interactiveMode, setInteractiveMode] = useState(false);
  const [edition, setEdition] = useState<string>(DEFAULT_EDITION_ID);
  const [useAcg, setUseAcg] = useState(false);
  const [acgPathway, setAcgPathway] = useState<string>("");
  const [acgForm, setAcgFormState] = useState<AcgFormState>(initialAcgFormState);
  const [preferredService, setPreferredService] = useState<
    ServiceKey | "random"
  >("random");

  // Mirror character + phase in refs so async handlers see the latest
  // values, not the closure-captured ones. Functional setState would be
  // React-idiomatic but its updater re-runs in dev StrictMode, which
  // would re-roll dice.
  const characterRef = useRef<Character | null>(null);
  useEffect(() => {
    characterRef.current = character;
  }, [character]);
  const phaseRef = useRef<Phase>("start");
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const commit = (c: Character, p: Phase) => {
    characterRef.current = c;
    phaseRef.current = p;
    setCharacter(c);
    setPhase(p);
  };

  const applySnap = (snap: session.ChargenSnapshot) => {
    commit(snap.character, snap.phase as Phase);
  };

  const setAcgForm = (patch: Partial<AcgFormState>) =>
    setAcgFormState((prev) => ({ ...prev, ...patch }));

  const startCareer = () => {
    const editionMeta = listEditions().find((e) => e.id === edition);
    applySnap(session.startCareer({
      edition,
      verbose,
      interactiveMode,
      supportsInteractive: editionMeta?.supportsInteractive === true,
      useAcg,
      acgPathway,
    }));
  };

  /** Apply a pre-career option. Session.applyPreCareer returns optional
   *  UI hints (auto-enlist pathway, service, fleet) when an academy
   *  outcome should pre-populate the enlistment form. */
  const applyPreCareer = (opt: session.PreCareerOption) => {
    const prev = characterRef.current;
    if (!prev) return;
    const result = session.applyPreCareer(
      { character: prev, phase: phaseRef.current },
      opt,
    );
    applySnap(result.snapshot);
    if (opt === "skip") {
      setAcgPathway("");
      setAcgForm({ service: "army", fleet: "imperialNavy" });
    }
    if (result.hints) {
      if (result.hints.acgPathway) setAcgPathway(result.hints.acgPathway);
      if (result.hints.acgService) setAcgForm({ service: result.hints.acgService });
      if (result.hints.acgFleet) setAcgForm({ fleet: result.hints.acgFleet });
    }
  };

  const resolvePending = (choiceId: string, optionIdx: number) => {
    const prev = characterRef.current;
    if (!prev) return;
    applySnap(session.resolvePending(
      { character: prev, phase: phaseRef.current },
      choiceId, optionIdx,
    ));
  };

  const enlist = () => {
    const prev = characterRef.current;
    if (!prev) return;
    applySnap(session.enlist(
      { character: prev, phase: phaseRef.current },
      {
        verbose,
        preferredService,
        acgService: acgForm.service,
        acgCombatArm: acgForm.combatArm,
        acgFleet: acgForm.fleet,
        acgDivision: acgForm.division,
        acgLineType: acgForm.lineType,
        acgSubsectorTech: acgForm.subsectorTech,
        acgMerchantAcademy: acgForm.merchantAcademy,
      },
    ));
  };

  const runTerm = () => {
    const prev = characterRef.current;
    if (!prev) return;
    applySnap(session.runTerm({
      character: prev, phase: phaseRef.current,
    }));
  };

  const attemptMusterOut = () => {
    const prev = characterRef.current;
    if (!prev) return;
    applySnap(session.attemptMusterOut({
      character: prev, phase: phaseRef.current,
    }));
  };

  const pickSkill = (table: number) => {
    const prev = characterRef.current;
    if (!prev) return;
    applySnap(session.pickSkill(
      { character: prev, phase: phaseRef.current },
      table,
    ));
  };

  const musterChoice = (kind: "cash" | "benefit") => {
    const prev = characterRef.current;
    if (!prev) return;
    applySnap(session.musterChoice(
      { character: prev, phase: phaseRef.current },
      kind,
    ));
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
              acgPathway={acgPathway}
              form={acgForm}
              setForm={setAcgForm}
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
