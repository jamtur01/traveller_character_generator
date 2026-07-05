"use client";

import type { Character } from "@/lib/traveller/character";
import { PhaseCard } from "./ui";

export function PendingChoicesPanel({
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
      {first.progress && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Selection {first.progress.current} of {first.progress.total}
        </p>
      )}
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
            {first.optionLabels?.[i] ?? String(opt)}
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
