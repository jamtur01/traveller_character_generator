"use client";

import type { Character } from "@/lib/traveller/character";
import {
  PhaseCard, PrimaryButton, SecondaryButton,
} from "../ui";
import { MusterLog } from "./MusterPhase";

export function EndPhase({
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
