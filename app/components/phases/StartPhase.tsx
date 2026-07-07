"use client";

import { listEditions } from "@/lib/traveller/editions";
import type { EditionMeta } from "@/lib/traveller/editions/types";
import { editionHasAcg } from "@/lib/traveller";
import { optionDomain } from "@/lib/traveller/editions/optionDomains";
import {
  CARD, SECTION_LABEL, FormField, FormSelect, PrimaryButton,
} from "@/app/components/ui";

function editionSummary(meta: EditionMeta): string {
  return meta.description
    ?? "Edition data extracted from its rulebook. See data/editions for details.";
}

function workflowStepsFor(meta: EditionMeta, useAcg: boolean): string[] {
  const { workflowSteps } = meta;
  return useAcg && workflowSteps.acg ? workflowSteps.acg : workflowSteps.default;
}

function EditionWorkflow({
  meta,
  useAcg,
}: {
  meta: EditionMeta;
  useAcg: boolean;
}) {
  const steps = workflowStepsFor(meta, useAcg);
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900/50">
      <div className={SECTION_LABEL}>What happens next</div>
      <ol className="mt-2 space-y-1.5 text-sm text-zinc-700 dark:text-zinc-300">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 font-mono text-[10px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function EditionCard({
  meta,
  selected,
  onSelect,
}: {
  meta: EditionMeta;
  selected: boolean;
  onSelect: () => void;
}) {
  const dataOnly = meta.status === "data-only";
  const summary = editionSummary(meta);
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={dataOnly}
      aria-pressed={selected}
      className={[
        "group relative flex flex-col gap-2 rounded-lg border p-4 text-left transition",
        "focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-950",
        selected
          ? "border-emerald-500 bg-emerald-50 shadow-md ring-2 ring-emerald-500/30 dark:border-emerald-400 dark:bg-emerald-950/40"
          : dataOnly
            ? "cursor-not-allowed border-zinc-200 bg-zinc-50 opacity-60 dark:border-zinc-800 dark:bg-zinc-900"
            : "border-zinc-200 bg-white hover:border-emerald-400 hover:bg-emerald-50/50 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-emerald-600 dark:hover:bg-emerald-950/20",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-sm font-bold uppercase tracking-wider text-zinc-900 dark:text-zinc-50">
            {meta.name}
          </div>
          {meta.year && (
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              {meta.year}
            </div>
          )}
        </div>
        {dataOnly && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            Data only
          </span>
        )}
      </div>
      <div className="text-xs text-zinc-600 dark:text-zinc-400">
        Based on:{" "}
        <span className="italic">{meta.rulebooks.join(", ")}</span>
      </div>
      <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{summary}</p>
      {dataOnly && (
        <p className="text-xs italic text-amber-700 dark:text-amber-400">
          JSON data extracted, engine not yet implemented.
        </p>
      )}
    </button>
  );
}

export function StartPhase({
  onStart,
  interactiveMode,
  setInteractiveMode,
  edition,
  setEdition,
  useAcg,
  setUseAcg,
  acgPathway,
  setAcgPathway,
}: {
  onStart: () => void;
  interactiveMode: boolean;
  setInteractiveMode: (v: boolean) => void;
  edition: string;
  setEdition: (v: string) => void;
  useAcg: boolean;
  setUseAcg: (v: boolean) => void;
  acgPathway: string;
  setAcgPathway: (v: string) => void;
}) {
  const editions = listEditions();
  const selected = editions.find((e) => e.id === edition);
  const hasAcg = editionHasAcg(edition);
  const acgPathways = hasAcg ? optionDomain(edition, "acg.pathway").values : [];

  return (
    <div className="space-y-6">
      <div className={CARD + " space-y-4"}>
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            1. Choose an edition
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Each edition has its own services, skills, and lifecycle. You can
            generate one character per edition; switching here resets the form.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {editions.map((e) => (
            <EditionCard
              key={e.id}
              meta={e}
              selected={e.id === edition}
              onSelect={() => {
                if (e.status === "data-only") return;
                setEdition(e.id);
                if (!editionHasAcg(e.id)) {
                  setUseAcg(false);
                  setAcgPathway("");
                }
              }}
            />
          ))}
        </div>
      </div>

      <div className={CARD + " space-y-5"}>
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            2. Workflow & options
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Two dice rolled six times produce your Universal Personality
            Profile, then the selected edition&apos;s lifecycle runs.
          </p>
        </div>

        {selected && <EditionWorkflow meta={selected} useAcg={useAcg && hasAcg} />}

        <div className="space-y-3">
          {selected?.supportsInteractive && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={interactiveMode}
                onChange={(e) => setInteractiveMode(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                  Interactive choices
                </span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                  Pause for player decisions — which blade or gun a weapon
                  benefit becomes, which specific item a cascade resolves to,
                  etc. Off = the original auto-everything flow.
                </span>
              </span>
            </label>
          )}

          {hasAcg && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={useAcg}
                onChange={(e) => {
                  setUseAcg(e.target.checked);
                  if (e.target.checked && !acgPathway && acgPathways[0]) {
                    setAcgPathway(acgPathways[0]);
                  }
                }}
                className="mt-0.5"
              />
              <span>
                <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                  Use Advanced Character Generation
                </span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                  Per-year assignment cycle with branch / MOS rolls,
                  specialist schools, command duty, brownie points, and
                  decorations. (PM pp. 44-65.)
                </span>
              </span>
            </label>
          )}
        </div>
      </div>

      {hasAcg && useAcg && (
        <div className={CARD + " space-y-4"}>
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              3. Advanced Character Generation
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              ACG is the optional rules-heavy chargen system in MT (PM
              pp. 44-65). Each pathway is its own career book — Mercenary
              (Army/Marines), Navy, Scout, or Merchant Prince — with its
              own per-year assignment cycle. Pick a pathway here; you&apos;ll
              configure the starting branch / role at enlistment, after
              optional pre-career.
            </p>
          </div>

          <FormField
            label="Pathway"
            hint="Which ACG career book to follow. Each has its own enlistment table, assignments, schools, and ranks."
          >
            <FormSelect value={acgPathway} onChange={setAcgPathway}>
              <option value="" disabled>
                Select a pathway…
              </option>
              {acgPathways.map((p) => (
                <option key={p} value={p}>
                  {p === "merchantPrince"
                    ? "Merchant Prince"
                    : p.charAt(0).toUpperCase() + p.slice(1)}
                </option>
              ))}
            </FormSelect>
          </FormField>
        </div>
      )}

      <div className="flex justify-end">
        <PrimaryButton
          onClick={onStart}
          disabled={useAcg && hasAcg && !acgPathway}
        >
          Roll attributes &amp; begin →
        </PrimaryButton>
      </div>
    </div>
  );
}
