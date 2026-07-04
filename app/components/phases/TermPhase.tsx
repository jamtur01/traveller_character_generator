"use client";

import type { Character } from "@/lib/traveller/character";
import { getEdition } from "@/lib/traveller/editions";
import {
  anagathicsEligible, termLengthYears,
} from "@/lib/traveller/editions/view";
import { getEditionServices } from "@/lib/traveller/services";
import {
  PhaseCard, PrimaryButton, SecondaryButton, Stat,
} from "@/app/components/ui";

export function TermPhase({
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
  const termYears = termLengthYears(character.editionId);
  const nextAge = character.age + termYears;
  const def = getEditionServices(character.editionId)[character.service]!;

  const canMusterOut =
    character.terms >= 1 && !character.mandatoryReenlistment;

  // MT (PM p. 16) vs CT (TTB p. 11): the MT ruleset (skill-cap capability)
  // adds a position/commission + special-duty flow and treats survival
  // failure as a short term rather than death. Read the typed edition view
  // instead of probing raw `data.rules` shape.
  const edition = getEdition(character.editionId);
  const failureIsDeath =
    (edition.rules.survival?.onFailure ?? "death") === "death";
  const checklist = edition.meta.hasSkillCap
    ? "Survival, position/commission and promotion, special duty, skills, then aging from age 34. End-of-term: reenlistment, mustering out."
    : "Survival, commission, promotion, skills, then aging from age 34. End-of-term: reenlistment, mustering out.";

  return (
    <PhaseCard
      title={`Term ${termNum} of service`}
      subtitle={`You'll be ${nextAge} years old after this term. Each term is ${termYears} years. ${checklist}`}
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

      {anagathicsEligible(character) && (
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
