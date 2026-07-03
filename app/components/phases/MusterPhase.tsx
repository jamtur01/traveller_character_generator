"use client";

import type { Character } from "@/lib/traveller/character";
import {
  benefitDmFor, cashDmFor, maxCashRolls,
} from "@/lib/traveller/engine/musterDm";
import {
  PhaseCard, SecondaryButton, Stat, SECTION_LABEL,
} from "@/app/components/ui";

export function MusterLog({ log }: { log: string[] }) {
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

export function MusterPhase({
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
