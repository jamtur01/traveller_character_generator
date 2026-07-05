"use client";

import type { Character } from "@/lib/traveller/character";
import { PhaseCard, PrimaryButton, SecondaryButton, Stat } from "@/app/components/ui";
import { currentCareerLabel, currentAssignmentLabel, currentRankTitle } from "@/lib/traveller";

/** Between careers (Mongoose): begin another career or finish generation.
 *  Career + assignment selection happens through the pending-choices panel once
 *  "Begin a career" is pressed. */
export function MongooseCareerPhase({
  character,
  onBeginCareer,
  onFinish,
}: {
  character: Character;
  onBeginCareer: () => void;
  onFinish: () => void;
}) {
  const st = character.mongooseState;
  const careerCount = st?.careerCount ?? 0;
  return (
    <PhaseCard
      title={careerCount === 0 ? "Begin your first career" : "Between careers"}
      subtitle="Attempt to qualify for a career, submit to the draft, or drift. Choose the career and assignment in the prompt that follows."
    >
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Stat label="Age" value={String(character.age)} />
        <Stat label="Terms" value={String(character.terms)} />
        <Stat label="Careers" value={String(careerCount)} />
      </dl>
      <div className="flex flex-wrap gap-2 pt-1">
        <PrimaryButton onClick={onBeginCareer}>Begin a career</PrimaryButton>
        <SecondaryButton onClick={onFinish}>Finish character</SecondaryButton>
      </div>
    </PhaseCard>
  );
}

/** In a career (Mongoose): run another four-year term or muster out. */
export function MongooseTermPhase({
  character,
  onRunTerm,
  onMusterOut,
}: {
  character: Character;
  onRunTerm: () => void;
  onMusterOut: () => void;
}) {
  const st = character.mongooseState;
  const career = currentCareerLabel(character);
  const assignment = currentAssignmentLabel(character);
  const rankTitle = currentRankTitle(character);
  const mustContinue = st?.perTerm.mustContinue ?? false;
  const isPrisoner = (st?.paroleThreshold ?? null) !== null;
  return (
    <PhaseCard
      title={`${career} — ${assignment}`}
      subtitle={`Term ${(st?.termsInCareer ?? 0) + 1}. Each term is four years: qualification (once), survival, events, advancement, and skills.`}
    >
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Stat label="Rank" value={rankTitle ?? "—"} />
        <Stat label="Age" value={String(character.age)} />
        <Stat label="Terms in career" value={String(st?.termsInCareer ?? 0)} />
      </dl>
      {mustContinue && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          {isPrisoner
            ? "You were not paroled this term — you must serve another term in this career."
            : "You rolled a natural 12 on advancement — you must serve at least one more term in this career."}
        </p>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <PrimaryButton onClick={onRunTerm}>Run term</PrimaryButton>
        {!mustContinue && !isPrisoner && (
          <SecondaryButton onClick={onMusterOut}>Muster out of this career</SecondaryButton>
        )}
      </div>
    </PhaseCard>
  );
}
