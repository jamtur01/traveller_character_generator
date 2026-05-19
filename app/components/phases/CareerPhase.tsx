"use client";

import type { Character } from "@/lib/traveller/character";
import {
  getEditionServices, getEnlistableServices, serviceLabel,
} from "@/lib/traveller/services";
import type { ServiceKey } from "@/lib/traveller/types";
import { PhaseCard, PrimaryButton, SECTION_LABEL } from "../ui";

export function CareerPhase({
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
  const def = targetSvc ? getEditionServices(character.editionId)[targetSvc] ?? null : null;
  const dm = def ? def.enlistmentDM(character.attributes) : 0;
  const target = def ? def.enlistmentThrow : 0;
  // Only services in the *character's* edition are valid picks. The cross-
  // edition union was leaking CT-only services into MT pickers and vice
  // versa, causing edition-specific service lookups to throw later.
  const enlistableForEdition = getEnlistableServices(character.editionId);

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
          {enlistableForEdition.map((k) => (
            <option key={k} value={k}>
              {serviceLabel(k, character.editionId)}
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
