"use client";

import type { Character } from "@/lib/traveller/character";
import { formatEvent, visibleAt } from "@/lib/traveller/history";
import { CARD } from "./ui";

export function HistoryPanel({ character }: { character: Character }) {
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
