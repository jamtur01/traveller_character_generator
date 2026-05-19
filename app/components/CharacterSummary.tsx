"use client";

import type { Character } from "@/lib/traveller/character";
import { getEditionServices } from "@/lib/traveller/services";
import { aggregateBenefits } from "@/lib/traveller/sheet";
import { extendedHex, numCommaSep } from "@/lib/traveller/formatting";
import type { AttributeKey } from "@/lib/traveller/types";
import { CARD, SECTION_LABEL, Field } from "./ui";

const ATTR_LABELS: { key: AttributeKey; short: string }[] = [
  { key: "strength", short: "Str" },
  { key: "dexterity", short: "Dex" },
  { key: "endurance", short: "End" },
  { key: "intelligence", short: "Int" },
  { key: "education", short: "Edu" },
  { key: "social", short: "Soc" },
];

export function CharacterSummary({ character }: { character: Character }) {
  const def = getEditionServices(character.editionId)[character.service];
  const rankText = def?.ranks[character.rank] || "";
  const titleText =
    character.attributes.social > 10 ? character.getNobleTitle() : "";
  const memberText =
    !def || character.service === "other" ? "" : def.memberName;
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
        <Field label="Service" value={def?.serviceName ?? ""} />
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
