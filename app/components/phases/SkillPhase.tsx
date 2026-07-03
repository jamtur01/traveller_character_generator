"use client";

import type { Character } from "@/lib/traveller/character";
import { PhaseCard, SecondaryButton } from "@/app/components/ui";

export function SkillPhase({
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
