"use client";

import type { Character } from "@/lib/traveller/character";
import type * as session from "@/lib/traveller/chargen/session";

type Phase = session.ChargenPhase;

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

export function Stepper({ phase, character }: { phase: Phase; character: Character | null }) {
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
