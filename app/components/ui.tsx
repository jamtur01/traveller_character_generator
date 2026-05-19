"use client";

// Shared UI atoms — Tailwind class constants, form fields, buttons,
// page chrome. Phase components and chargen UI build on these.

import type React from "react";

export const CARD =
  "rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950";
export const SECTION_LABEL =
  "text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400";
export const SELECT_CLASS =
  "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

const BUTTON_BASE =
  "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium shadow-sm transition focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50";

export function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-semibold text-zinc-700 dark:text-zinc-300">
        {label}
      </span>
      {children}
      {hint && (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>
      )}
    </label>
  );
}

export function FormSelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={SELECT_CLASS}
    >
      {children}
    </select>
  );
}

export function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className={SECTION_LABEL}>{label}</dt>
      <dd className="font-mono text-sm text-zinc-900 dark:text-zinc-100">
        {value}
      </dd>
    </>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className={SECTION_LABEL}>{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {hint}
        </div>
      )}
    </div>
  );
}

export function PhaseCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={CARD + " space-y-4"}>
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  variant = "emerald",
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "emerald" | "indigo-dark";
  disabled?: boolean;
}) {
  const cls =
    variant === "indigo-dark"
      ? "bg-indigo-800 text-white hover:bg-indigo-700 focus:ring-indigo-500"
      : "bg-emerald-700 text-white hover:bg-emerald-600 focus:ring-emerald-500";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${BUTTON_BASE} ${cls}`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  variant = "zinc",
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "zinc" | "amber" | "amber-light" | "indigo" | "emerald";
  title?: string;
}) {
  const map: Record<string, string> = {
    zinc: "bg-zinc-700 text-white hover:bg-zinc-600 focus:ring-zinc-500",
    amber: "bg-amber-700 text-white hover:bg-amber-600 focus:ring-amber-500",
    "amber-light":
      "bg-amber-600 text-white hover:bg-amber-500 focus:ring-amber-400",
    indigo:
      "bg-indigo-700 text-white hover:bg-indigo-600 focus:ring-indigo-500",
    emerald:
      "bg-emerald-700 text-white hover:bg-emerald-600 focus:ring-emerald-500",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`${BUTTON_BASE} ${map[variant]}`}
    >
      {children}
    </button>
  );
}

export function PageHeader({
  verbose,
  onToggleVerbose,
  editionLabel,
}: {
  verbose: boolean;
  onToggleVerbose: (v: boolean) => void;
  editionLabel: string;
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-zinc-200 pb-5 dark:border-zinc-800">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-mono text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
            Traveller Character Generator
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Edition: <span className="font-semibold text-zinc-700 dark:text-zinc-200">{editionLabel}</span>
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={verbose}
            onChange={(e) => onToggleVerbose(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300"
          />
          Verbose history
        </label>
      </div>
    </header>
  );
}

export function PageFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-4 space-y-2 border-t border-zinc-200 pt-5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
      <p>
        Inspired by{" "}
        <a
          className="underline decoration-zinc-400 underline-offset-2 hover:no-underline dark:decoration-zinc-600"
          href="https://github.com/pgorman/travellercharactergenerator"
          target="_blank"
          rel="noopener noreferrer"
        >
          Paul Gorman&apos;s
        </a>{" "}
        original JS generator (2015). Rules data derived from{" "}
        <em>The Traveller Book</em> (1981), <em>Citizens of the Imperium</em>{" "}
        (CT Supplement 4), and the <em>MegaTraveller Players&apos; Manual</em>{" "}
        (1987).
      </p>
      <p>
        <em>Traveller</em> is a trademark of Far Future Enterprises. The
        rulebook content is © Game Designers&apos; Workshop / Marc Miller;
        this generator is a fan tool and is not affiliated with or endorsed by
        the rights holders.
      </p>
      <p>Generator code © {year} — released under the MIT License.</p>
    </footer>
  );
}
