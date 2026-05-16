"use client";

import { useEffect, useRef, useState } from "react";
import {
  Character,
  benefitDmFor,
  cashDmFor,
  cloneCharacter,
  DEFAULT_EDITION_ID,
  ENLISTABLE_SERVICES,
  aggregateBenefits,
  editionHasAcg,
  extendedHex,
  intToOrdinal,
  listAcgPathways,
  listEditions,
  numCommaSep,
  roll,
  s,
  serviceLabel,
  type AttributeKey,
  type ServiceKey,
} from "@/lib/traveller";
import { downloadCharacterSheetPdf } from "@/lib/pdfSheet";

type Phase =
  | "start"
  | "career"
  | "term"
  | "skill_basic"
  | "skill_adv"
  | "muster"
  | "muster_no_cash"
  | "end";

const MAX_CASH_ROLLS = 3;

function pickSkillPhase(c: Character): Phase {
  return c.attributes.education >= 8 ? "skill_adv" : "skill_basic";
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("start");
  const [character, setCharacter] = useState<Character | null>(null);
  const [verbose, setVerbose] = useState(false);
  const [interactiveMode, setInteractiveMode] = useState(false);
  const [edition, setEdition] = useState<string>(DEFAULT_EDITION_ID);
  const [useAcg, setUseAcg] = useState(false);
  const [acgPathway, setAcgPathway] = useState<string>("");
  const [acgService, setAcgService] = useState<"army" | "marines">("army");
  const [acgCombatArm, setAcgCombatArm] = useState<string>("Infantry");
  const [acgFleet, setAcgFleet] = useState<
    "imperialNavy" | "reserveFleet" | "systemSquadron"
  >("imperialNavy");
  const [acgDivision, setAcgDivision] = useState<"field" | "bureaucracy">("field");
  const [acgLineType, setAcgLineType] = useState<string>("Free Trader");
  const [preferredService, setPreferredService] = useState<
    ServiceKey | "random"
  >("random");

  // Mirror the character state in a ref. Each handler reads from the ref and
  // updates it synchronously before calling setCharacter — so rapid back-to-
  // back clicks always operate on the latest character, not a stale closure.
  // Functional setState would seem like the React-idiomatic fix here, but its
  // updater body would be re-invoked in dev StrictMode, re-rolling dice.
  const characterRef = useRef<Character | null>(null);
  useEffect(() => {
    characterRef.current = character;
  }, [character]);

  const commit = (c: Character, p: Phase) => {
    characterRef.current = c;
    setCharacter(c);
    setPhase(p);
  };

  const startCareer = () => {
    const c = new Character();
    c.editionId = edition;
    c.showHistory = verbose ? "verbose" : "simple";
    // MT homeworld generation (p. 12-13) — runs after attribute roll
    // (which happens in the Character constructor) and BEFORE service
    // selection. Gates which careers the character can enlist in.
    c.generateHomeworld();
    // Only enable interactive mode if the active edition opts in (CT does
    // not). This makes the chosen edition's metadata the authority — the
    // checkbox is disabled in that case but we double-guard the flag here.
    const editionMeta = listEditions().find((e) => e.id === edition);
    c.choiceMode = (interactiveMode && editionMeta?.supportsInteractive)
      ? "interactive"
      : "auto";
    // ACG is only available on editions that declare it, and only when
    // the user picks a pathway. Double-guard: ignore the flag if either
    // condition fails.
    if (useAcg && editionHasAcg(edition) && acgPathway) {
      c.useAcg = true;
      c.acgPathway = acgPathway;
    }
    commit(c, "career");
  };

  const resolvePending = (choiceId: string, optionIdx: number) => {
    const prev = characterRef.current;
    if (!prev) return;
    const c = cloneCharacter(prev);
    c.resolveChoice(choiceId, optionIdx);
    commit(c, phase);
  };

  const enlist = () => {
    const prev = characterRef.current;
    if (!prev) return;
    const c = cloneCharacter(prev);
    c.showHistory = verbose ? "verbose" : "simple";
    if (c.useAcg && c.acgPathway) {
      // ACG: bypass basic doEnlistment and call the pathway-specific
      // enlist via beginAcg with the user's sub-option choices.
      try {
        c.beginAcg(c.acgPathway as "mercenary" | "navy" | "scout" | "merchantPrince", {
          service: acgService,
          combatArm: acgCombatArm,
          fleet: acgFleet,
          division: acgDivision,
          lineType: acgLineType,
        });
      } catch (err) {
        // beginAcg throws on enlistment rejection; surface to the user.
        c.history.push(`ACG enlistment failed: ${(err as Error).message}`);
        commit(c, "end");
        return;
      }
    } else {
      c.service = c.doEnlistment(
        preferredService === "random" ? "" : preferredService,
      );
    }
    commit(c, "term");
  };

  const runTerm = () => {
    const prev = characterRef.current;
    if (!prev) return;
    const c = cloneCharacter(prev);
    // CotI: Noble rank corresponds to Social Standing − 10 from the start
    // (B Knight at Soc 11 through F Duke at Soc 15).
    if (c.service === "nobles") {
      if (c.attributes.social < 10) c.attributes.social = 10;
      const startingRank = c.attributes.social - 10;
      if (c.rank < startingRank && startingRank >= 1 && startingRank <= 5) {
        c.rank = startingRank;
        c.commissioned = true;
      }
    }
    c.doServiceTermStep();
    if (!c.deceased) c.doAging();

    if (c.deceased) {
      commit(c, "end");
    } else if (c.skillPoints > 0) {
      commit(c, pickSkillPhase(c));
    } else {
      commit(c, "term");
    }
  };

  const attemptMusterOut = () => {
    const prev = characterRef.current;
    if (!prev) return;
    // Per TTB p. 18: a roll-of-12 mandatory reenlistment forces another term
    // regardless of the character's preference. Block voluntary muster-out
    // until the forced term has been served.
    if (prev.mandatoryReenlistment) return;
    const c = cloneCharacter(prev);
    const r = roll(2);
    c.verboseHistory(`Voluntary muster-out roll ${r} (12 forces another term)`);
    if (r === 12) {
      c.mandatoryReenlistment = true;
      c.history.push(
        `Mandatory reenlistment for ${intToOrdinal(c.terms + 1)} term despite attempt to muster out.`,
      );
      commit(c, "term");
      return;
    }
    // Apply aging for the term they're leaving, matching runTerm's flow.
    c.doAging();
    if (c.deceased) {
      c.history.push("======= End Generation =======");
      commit(c, "end");
      return;
    }
    c.activeDuty = false;
    if (c.terms >= 5 && c.service !== "scouts" && c.service !== "other")
      c.retired = true;
    c.history.push(
      `Voluntarily mustered out after ${intToOrdinal(c.terms)} term of service.`,
    );
    c.musteredOut = true;
    c.musterRolls = c.musterOutRolls();
    if (c.musterRolls === 0) {
      c.musterOutPay();
      c.history.push("======= End Generation =======");
      commit(c, "end");
    } else {
      commit(c, "muster");
    }
  };

  const pickSkill = (table: number) => {
    const prev = characterRef.current;
    if (!prev) return;
    const c = cloneCharacter(prev);
    if (table === 0) {
      c.forceTable = false;
    } else {
      c.forceTable = true;
      c.forceTableIndex = table;
    }
    s[c.service].acquireSkill(c);
    c.skillPoints -= 1;

    if (c.skillPoints > 0) {
      commit(c, pickSkillPhase(c));
      return;
    }

    if (!c.deceased) c.doReenlistmentStep();

    if (c.deceased) {
      commit(c, "end");
      return;
    }

    if (!c.activeDuty) {
      c.musteredOut = true;
      c.musterRolls = c.musterOutRolls();
      if (c.musterRolls === 0) {
        // Bug fix: was skipping retirement pay on this direct-to-end path.
        c.musterOutPay();
        c.history.push("======= End Generation =======");
        commit(c, "end");
      } else {
        commit(c, "muster");
      }
      return;
    }

    commit(c, "term");
  };

  const musterChoice = (kind: "cash" | "benefit") => {
    const prev = characterRef.current;
    if (!prev) return;
    const c = cloneCharacter(prev);
    // Compute DMs from the active edition's rules.musterOutRolls block —
    // CT and MT differ on which conditions apply (MT adds Retired and
    // Prospecting-1 for select services).
    const cashDM = cashDmFor(c);
    const benefitsDM = benefitDmFor(c);

    if (kind === "cash") {
      c.musterOutCash(cashDM);
      c.musterCashUsed += 1;
    } else {
      c.musterOutBenefit(benefitsDM);
    }
    c.musterRolls -= 1;

    if (c.musterRolls === 0) {
      c.musterOutPay();
      c.history.push("======= End Generation =======");
      commit(c, "end");
    } else if (c.musterCashUsed >= MAX_CASH_ROLLS) {
      commit(c, "muster_no_cash");
    } else {
      commit(c, "muster");
    }
  };

  const toggleVerbose = (v: boolean) => {
    setVerbose(v);
    const prev = characterRef.current;
    if (prev) {
      const c = cloneCharacter(prev);
      c.showHistory = v ? "verbose" : "simple";
      characterRef.current = c;
      setCharacter(c);
    }
  };

  const reset = () => {
    characterRef.current = null;
    setCharacter(null);
    setPhase("start");
  };

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        verbose={verbose}
        onToggleVerbose={toggleVerbose}
        editionLabel={
          listEditions().find(
            (e) => e.id === (character?.editionId ?? edition),
          )?.displayName ?? edition
        }
      />

      <Stepper phase={phase} />

      <div
        className={
          character
            ? "grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]"
            : "grid gap-6"
        }
      >
        {character && (
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <CharacterSummary character={character} />
          </aside>
        )}

        <section className="flex flex-col gap-6">
          {character && character.pendingChoices.length > 0 && (
            <PendingChoicesPanel
              character={character}
              onResolve={resolvePending}
            />
          )}

          {phase === "start" && (
            <StartPhase
              onStart={startCareer}
              interactiveMode={interactiveMode}
              setInteractiveMode={setInteractiveMode}
              edition={edition}
              setEdition={setEdition}
              useAcg={useAcg}
              setUseAcg={setUseAcg}
              acgPathway={acgPathway}
              setAcgPathway={setAcgPathway}
              acgService={acgService}
              setAcgService={setAcgService}
              acgCombatArm={acgCombatArm}
              setAcgCombatArm={setAcgCombatArm}
              acgFleet={acgFleet}
              setAcgFleet={setAcgFleet}
              acgDivision={acgDivision}
              setAcgDivision={setAcgDivision}
              acgLineType={acgLineType}
              setAcgLineType={setAcgLineType}
            />
          )}

          {phase === "career" && character && (
            <CareerPhase
              character={character}
              preferredService={preferredService}
              setPreferredService={setPreferredService}
              onEnlist={enlist}
            />
          )}

          {phase === "term" && character && (
            <TermPhase
              character={character}
              onRunTerm={runTerm}
              onMusterOut={attemptMusterOut}
            />
          )}

          {(phase === "skill_basic" || phase === "skill_adv") && character && (
            <SkillPhase
              character={character}
              phase={phase}
              onPick={pickSkill}
            />
          )}

          {(phase === "muster" || phase === "muster_no_cash") && character && (
            <MusterPhase
              character={character}
              phase={phase}
              onChoose={musterChoice}
            />
          )}

          {phase === "end" && character && (
            <EndPhase
              character={character}
              onRestart={reset}
              onDownloadPdf={() => downloadCharacterSheetPdf(character)}
            />
          )}
        </section>
      </div>

      {character && character.history.length > 0 && (
        <HistoryPanel character={character} />
      )}

      <PageFooter />
    </main>
  );
}

function PageFooter() {
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
        <em>The Traveller Book</em> (1981) and <em>Citizens of the Imperium</em>{" "}
        (CT Supplement 4).
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

// ---------- shared UI ----------

const CARD =
  "rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950";
const SECTION_LABEL =
  "text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400";

function PageHeader({
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

const STEPPER_STEPS: { id: string; label: string; phases: Phase[] }[] = [
  { id: "roll", label: "Roll", phases: ["start"] },
  { id: "enlist", label: "Enlist", phases: ["career"] },
  { id: "serve", label: "Serve", phases: ["term", "skill_basic", "skill_adv"] },
  { id: "muster", label: "Muster", phases: ["muster", "muster_no_cash"] },
  { id: "done", label: "Done", phases: ["end"] },
];

function Stepper({ phase }: { phase: Phase }) {
  const currentIdx = STEPPER_STEPS.findIndex((s) => s.phases.includes(phase));
  return (
    <ol className="flex items-center gap-1 overflow-x-auto pb-1 sm:gap-2">
      {STEPPER_STEPS.map((step, i) => {
        const state =
          i < currentIdx ? "done" : i === currentIdx ? "active" : "pending";
        const isLast = i === STEPPER_STEPS.length - 1;
        return (
          <li
            key={step.id}
            aria-current={state === "active" ? "step" : undefined}
            className="flex flex-1 items-center gap-2 last:flex-initial"
          >
            <div className="flex items-center gap-2">
              <span
                className={[
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  state === "done"
                    ? "bg-emerald-600 text-white"
                    : state === "active"
                      ? "bg-zinc-900 text-white ring-2 ring-emerald-500 ring-offset-2 dark:bg-zinc-100 dark:text-zinc-900 dark:ring-offset-zinc-950"
                      : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
                ].join(" ")}
              >
                {state === "done" ? "✓" : i + 1}
              </span>
              <span
                className={[
                  "text-xs font-medium sm:text-sm",
                  state === "active"
                    ? "text-zinc-900 dark:text-zinc-100"
                    : state === "done"
                      ? "text-zinc-700 dark:text-zinc-300"
                      : "text-zinc-400 dark:text-zinc-500",
                ].join(" ")}
              >
                {step.label}
              </span>
            </div>
            {!isLast && (
              <span
                className={[
                  "h-px flex-1",
                  state === "done"
                    ? "bg-emerald-600"
                    : "bg-zinc-200 dark:bg-zinc-800",
                ].join(" ")}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ---------- character summary ----------

const ATTR_LABELS: { key: AttributeKey; short: string }[] = [
  { key: "strength", short: "Str" },
  { key: "dexterity", short: "Dex" },
  { key: "endurance", short: "End" },
  { key: "intelligence", short: "Int" },
  { key: "education", short: "Edu" },
  { key: "social", short: "Soc" },
];

function CharacterSummary({ character }: { character: Character }) {
  const def = s[character.service];
  const rankText = def.ranks[character.rank] || "";
  const titleText =
    character.attributes.social > 10 ? character.getNobleTitle() : "";
  const memberText = character.service === "other" ? "" : def.memberName;
  const subtitleParts = [memberText, rankText, titleText].filter(Boolean);

  return (
    <div className={CARD + " space-y-4"}>
      <div>
        <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {character.deceased && (
            <span className="text-amber-700" aria-label="deceased">† </span>
          )}
          {character.name}
        </div>
        {subtitleParts.length > 0 && (
          <div className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
            {subtitleParts.join(" · ")}
          </div>
        )}
      </div>

      <div>
        <div className={SECTION_LABEL}>UPP</div>
        <div className="mt-2 grid grid-cols-6 gap-1 text-center">
          {ATTR_LABELS.map(({ key, short }) => (
            <div key={key}>
              <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {short}
              </div>
              <div className="rounded-md bg-zinc-50 py-1 font-mono text-base font-semibold text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
                {extendedHex(character.attributes[key])}
              </div>
            </div>
          ))}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Field label="Service" value={def.serviceName} />
        <Field label="Age" value={String(character.age)} />
        <Field label="Terms" value={String(character.terms)} />
        <Field
          label="Credits"
          value={
            character.deceased ? "—" : `Cr${numCommaSep(character.credits)}`
          }
        />
      </dl>

      <div>
        <div className={SECTION_LABEL}>Skills</div>
        {character.skills.length === 0 ? (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">—</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-1">
            {[...character.skills]
              .sort((a, b) => {
                if (b[1] !== a[1]) return b[1] - a[1];
                return a[0].localeCompare(b[0]);
              })
              .map(([n, l]) => (
                <li
                  key={n}
                  className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-xs text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
                >
                  {n}-{l}
                </li>
              ))}
          </ul>
        )}
      </div>

      <div>
        <div className={SECTION_LABEL}>Benefits</div>
        {character.benefits.length === 0 ? (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">—</p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-sm text-zinc-700 dark:text-zinc-300">
            {aggregateBenefits(character).map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className={SECTION_LABEL}>{label}</dt>
      <dd className="font-mono text-sm text-zinc-900 dark:text-zinc-100">
        {value}
      </dd>
    </>
  );
}

// ---------- phase components ----------

function PhaseCard({
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

function StartPhase({
  onStart,
  interactiveMode,
  setInteractiveMode,
  edition,
  setEdition,
  useAcg,
  setUseAcg,
  acgPathway,
  setAcgPathway,
  acgService,
  setAcgService,
  acgCombatArm,
  setAcgCombatArm,
  acgFleet,
  setAcgFleet,
  acgDivision,
  setAcgDivision,
  acgLineType,
  setAcgLineType,
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
  acgService: "army" | "marines";
  setAcgService: (v: "army" | "marines") => void;
  acgCombatArm: string;
  setAcgCombatArm: (v: string) => void;
  acgFleet: "imperialNavy" | "reserveFleet" | "systemSquadron";
  setAcgFleet: (v: "imperialNavy" | "reserveFleet" | "systemSquadron") => void;
  acgDivision: "field" | "bureaucracy";
  setAcgDivision: (v: "field" | "bureaucracy") => void;
  acgLineType: string;
  setAcgLineType: (v: string) => void;
}) {
  const editions = listEditions();
  const selected = editions.find((e) => e.id === edition);
  const dataOnly = selected?.status === "data-only";
  const hasAcg = editionHasAcg(edition);
  const acgPathways = hasAcg ? listAcgPathways(edition) : [];

  return (
    <PhaseCard
      title="Begin character generation"
      subtitle="Two dice are rolled six times to produce your Universal Personality Profile. Then you'll choose a service, run terms of duty, pick skills, and finally muster out."
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold text-zinc-700 dark:text-zinc-300">
          Edition
        </span>
        <select
          value={edition}
          onChange={(e) => setEdition(e.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          {editions.map((e) => (
            <option key={e.id} value={e.id} disabled={e.status === "data-only"}>
              {e.displayName}
            </option>
          ))}
        </select>
        {dataOnly && (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            Data extracted for this edition, but the engine doesn&apos;t yet
            implement its mechanics. Use Classic Traveller for now.
          </span>
        )}
        {editions.length === 1 && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            More editions coming. Drop a new JSON under data/editions/ and
            register it in lib/traveller/editions/index.ts.
          </span>
        )}
      </label>

      <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        <strong className="font-semibold">What happens next:</strong>
        <ol className="mt-2 list-decimal space-y-1 pl-4">
          <li>
            Roll 2d6 for each of the six characteristics (Str, Dex, End, Int,
            Edu, Soc).
          </li>
          <li>
            Choose a service or accept random; success determines enlistment vs.
            draft.
          </li>
          <li>
            Each four-year term: commission, promotion, skills, survival, then
            aging from age 34+.
          </li>
          <li>
            Muster out for cash and material benefits (ships, passages, weapons,
            TAS).
          </li>
        </ol>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={interactiveMode && selected?.supportsInteractive === true}
          disabled={selected?.supportsInteractive !== true}
          onChange={(e) => setInteractiveMode(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className={
            "font-semibold " +
            (selected?.supportsInteractive
              ? "text-zinc-700 dark:text-zinc-300"
              : "text-zinc-400 dark:text-zinc-600")
          }>
            Interactive choices
          </span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
            {selected?.supportsInteractive
              ? "When ticked, the engine pauses for player decisions — which blade or gun a weapon benefit becomes, which specific blade/gun a cascade resolves to, etc. Off = the original auto-everything flow."
              : `Classic Traveller chargen rolls procedurally per the rulebook; the only player choice each term (which skill table to roll on) is already supported in the main flow. Interactive mode is available on editions that opt in (currently: MegaTraveller).`}
          </span>
        </span>
      </label>

      {hasAcg && (
        <div className="rounded-md border border-zinc-300 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900">
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
                MT&apos;s ACG produces an enhanced character record with
                pathway, branch, brownie points, and decorations. Current
                implementation reuses the basic per-term flow and overlays
                ACG state — full branch / specialist school / MOS rolls
                are future work.
              </span>
            </span>
          </label>
          {useAcg && (
            <>
              <label className="mt-3 flex flex-col gap-1 text-sm">
                <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                  ACG pathway
                </span>
                <select
                  value={acgPathway}
                  onChange={(e) => setAcgPathway(e.target.value)}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="" disabled>
                    Select a pathway…
                  </option>
                  {acgPathways.map((p) => (
                    <option key={p} value={p}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </option>
                  ))}
                </select>
              </label>

              {acgPathway === "mercenary" && (
                <>
                  <label className="mt-3 flex flex-col gap-1 text-sm">
                    <span className="font-semibold text-zinc-700 dark:text-zinc-300">Service</span>
                    <select
                      value={acgService}
                      onChange={(e) => setAcgService(e.target.value as "army" | "marines")}
                      className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <option value="army">Army</option>
                      <option value="marines">Marines</option>
                    </select>
                  </label>
                  <label className="mt-3 flex flex-col gap-1 text-sm">
                    <span className="font-semibold text-zinc-700 dark:text-zinc-300">Combat arm</span>
                    <select
                      value={acgCombatArm}
                      onChange={(e) => setAcgCombatArm(e.target.value)}
                      className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <option value="Infantry">Infantry</option>
                      <option value="Cavalry">Cavalry</option>
                      <option value="Artillery">Artillery</option>
                      <option value="Support">Support</option>
                    </select>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      Commando is restricted to Military Academy honors graduates.
                    </span>
                  </label>
                </>
              )}

              {acgPathway === "navy" && (
                <label className="mt-3 flex flex-col gap-1 text-sm">
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">Fleet</span>
                  <select
                    value={acgFleet}
                    onChange={(e) => setAcgFleet(e.target.value as typeof acgFleet)}
                    className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <option value="imperialNavy">Imperial Navy (8+ to enlist)</option>
                    <option value="reserveFleet">Reserve Fleet (7+ to enlist)</option>
                    <option value="systemSquadron">System Squadron (6+, requires homeworld tech Early Stellar+)</option>
                  </select>
                </label>
              )}

              {acgPathway === "scout" && (
                <label className="mt-3 flex flex-col gap-1 text-sm">
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">Division</span>
                  <select
                    value={acgDivision}
                    onChange={(e) => setAcgDivision(e.target.value as "field" | "bureaucracy")}
                    className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <option value="field">Field (Survey, Communications, Exploration)</option>
                    <option value="bureaucracy">Bureaucracy (Technical, Operations, Administration, Detached Duty)</option>
                  </select>
                </label>
              )}

              {acgPathway === "merchantPrince" && (
                <label className="mt-3 flex flex-col gap-1 text-sm">
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">Line type</span>
                  <select
                    value={acgLineType}
                    onChange={(e) => setAcgLineType(e.target.value)}
                    className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <option value="Megacorp">Megacorp (9+, Class B starport+)</option>
                    <option value="Sector-wide">Sector-wide (8+, Class C+)</option>
                    <option value="Subsector-wide">Subsector-wide (7+, Class D+)</option>
                    <option value="Interface">Interface (7+)</option>
                    <option value="Fledgling">Fledgling (7+)</option>
                    <option value="Free Trader">Free Trader (7+)</option>
                  </select>
                </label>
              )}
            </>
          )}
        </div>
      )}

      <PrimaryButton
        onClick={onStart}
        disabled={useAcg && hasAcg && !acgPathway}
      >
        Roll attributes &amp; begin →
      </PrimaryButton>
    </PhaseCard>
  );
}

function PendingChoicesPanel({
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
            {opt}
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

function CareerPhase({
  character,
  preferredService,
  setPreferredService,
  onEnlist,
}: {
  character: Character;
  preferredService: ServiceKey | "random";
  setPreferredService: (v: ServiceKey | "random") => void;
  onEnlist: () => void;
}) {
  const targetSvc = preferredService === "random" ? null : preferredService;
  const def = targetSvc ? s[targetSvc] : null;
  const dm = def ? def.enlistmentDM(character.attributes) : 0;
  const target = def ? def.enlistmentThrow : 0;

  return (
    <PhaseCard
      title="Choose a service to attempt enlistment"
      subtitle="If your enlistment roll fails, you'll be drafted into one of: Navy, Marines, Army, Scouts, Sailors, or Flyers. Social 10+ characters are automatically enrolled into the Nobility if you leave this on Random."
    >
      <label className="flex flex-col gap-1.5">
        <span className={SECTION_LABEL}>Preferred service</span>
        <select
          value={preferredService}
          onChange={(e) =>
            setPreferredService(e.target.value as ServiceKey | "random")
          }
          className="max-w-xs rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >
          <option value="random">Random</option>
          {ENLISTABLE_SERVICES.map((k) => (
            <option key={k} value={k}>
              {serviceLabel(k)}
            </option>
          ))}
        </select>
      </label>

      {def && (
        <div className="rounded-md bg-zinc-50 p-3 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          <div className="font-mono">
            Enlistment throw {target}+ on 2d6
            {dm !== 0
              ? `, ${dm >= 0 ? "+" : ""}${dm} DM from your attributes`
              : ", no DMs"}
            .
          </div>
        </div>
      )}

      <PrimaryButton onClick={onEnlist}>Attempt enlistment →</PrimaryButton>
    </PhaseCard>
  );
}

function TermPhase({
  character,
  onRunTerm,
  onMusterOut,
}: {
  character: Character;
  onRunTerm: () => void;
  onMusterOut: () => void;
}) {
  const termNum = character.terms + 1;
  const nextAge = character.age + 4;
  const def = s[character.service];

  const canMusterOut =
    character.terms >= 1 && !character.mandatoryReenlistment;

  return (
    <PhaseCard
      title={`Term ${termNum} of service`}
      subtitle={`You'll be ${nextAge} years old after this term. Each term is 4 years and runs commission, promotion, skills, survival, then aging if you're 34 or older.`}
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
          hint="2d6, fail → death"
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

function Stat({
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

function SkillPhase({
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

function MusterPhase({
  character,
  phase,
  onChoose,
}: {
  character: Character;
  phase: "muster" | "muster_no_cash";
  onChoose: (kind: "cash" | "benefit") => void;
}) {
  const cashLeft = MAX_CASH_ROLLS - character.musterCashUsed;
  const cashDM = cashDmFor(character);
  const benefitDM = benefitDmFor(character);

  return (
    <PhaseCard
      title={`Muster out — ${character.musterRolls} roll${character.musterRolls === 1 ? "" : "s"} left`}
      subtitle={`Spend each remaining roll on either cash (max ${MAX_CASH_ROLLS} cash rolls) or a non-cash benefit. Gambling skill adds +1 DM on cash rolls; rank 5+ adds +1 DM on benefit rolls.`}
    >
      <dl className="grid grid-cols-3 gap-2">
        <Stat label="Rolls left" value={String(character.musterRolls)} />
        <Stat
          label="Cash rolls left"
          value={`${cashLeft} / ${MAX_CASH_ROLLS}`}
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

function MusterLog({ log }: { log: string[] }) {
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

function EndPhase({
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

// ---------- buttons ----------

const BUTTON_BASE =
  "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium shadow-sm transition focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50";

function PrimaryButton({
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

function SecondaryButton({
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

// ---------- history ----------

function HistoryPanel({ character }: { character: Character }) {
  return (
    <details className={CARD}>
      <summary className="cursor-pointer select-none text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Service history
        <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">
          ({character.history.length}{" "}
          {character.history.length === 1 ? "entry" : "entries"})
        </span>
      </summary>
      <ol className="mt-3 max-h-80 space-y-1 overflow-y-auto pr-2 text-sm text-zinc-700 dark:text-zinc-300">
        {character.history.map((line, i) => (
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
