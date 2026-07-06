"use client";

import type { Character } from "@/lib/traveller/character";
import { getAcgPathway } from "@/lib/traveller/editions";
import { optionDomain } from "@/lib/traveller/editions/optionDomains";
import {
  PhaseCard, FormField, FormSelect, PrimaryButton,
} from "@/app/components/ui";

export interface AcgFormState {
  service: "army" | "marines";
  combatArm: string;
  fleet: "imperialNavy" | "reserveFleet" | "systemSquadron";
  division: "field" | "bureaucracy";
  lineType: string;
  subsectorTech: string;
  merchantAcademy: boolean;
}

export const initialAcgFormState: AcgFormState = {
  service: "army",
  combatArm: "Infantry",
  fleet: "imperialNavy",
  division: "field",
  lineType: "Free Trader",
  subsectorTech: "",
  merchantAcademy: false,
};

/** Mercenary combat arms available in the enlistment dropdown, sourced
 *  from the edition JSON. Commando is filtered out (its honors-graduate
 *  gate is enforced by mercenaryEnlist) so the dropdown only lists arms
 *  the player can actually choose at first enlistment. */
function mercenaryNonCommandoArms(editionId: string): string[] {
  const merc = getAcgPathway(editionId, "mercenary");
  const arms = merc?.combatArms ?? [];
  const gated = new Set(Object.keys(merc?.combatArmEligibility?.armGates ?? {}));
  return arms.filter((a) => !gated.has(a));
}

/** Display labels for the navy fleet option domain. Presentation-only
 *  strings keyed by the declared fleet value; the enumerable itself is
 *  sourced from cited JSON via optionDomain("acg.navy.fleet"). */
const FLEET_LABELS: Record<string, string> = {
  imperialNavy: "Imperial Navy (8+ to enlist)",
  reserveFleet: "Reserve Fleet (7+ to enlist)",
  systemSquadron: "System Squadron (6+, requires Early Stellar+ homeworld)",
};

export function AcgEnlistPhase({
  character,
  edition,
  form,
  setForm,
  onEnlist,
}: {
  character: Character;
  edition: string;
  form: AcgFormState;
  setForm: (patch: Partial<AcgFormState>) => void;
  onEnlist: () => void;
}) {
  // Pathway is the source of truth on the character (set at startCareer);
  // deriving it here keeps the form correct regardless of transient page
  // state (a cleared page-level acgPathway used to blank this whole form).
  const acgPathway = character.acgPathway ?? "";
  const preCareerBranch = character.acgState?.preCareerBranch ?? null;
  const preCareerCommissioned =
    character.acgState?.preCareerCommission === true;
  const pathwayLabel =
    acgPathway === "merchantPrince"
      ? "Merchant Prince"
      : acgPathway.charAt(0).toUpperCase() + acgPathway.slice(1);

  return (
    <PhaseCard
      title={`Configure ${pathwayLabel} enlistment`}
      subtitle={
        preCareerCommissioned
          ? "Pre-career commissioned you — pick remaining sub-options and enlist."
          : "Per the PM ACG checklist, configure your starting branch / role for this pathway, then enlist."
      }
    >
      <div className="space-y-4">
        {acgPathway === "mercenary" && (
          <>
            <FormField
              label="Service"
              hint={
                preCareerBranch
                  ? `Pre-career fixed this to ${preCareerBranch === "army" ? "Army" : "Marines"}.`
                  : "Army (5+ to enlist, ground operations) or Marines (9+ to enlist, ship-board assignments available)."
              }
            >
              <FormSelect
                value={form.service}
                onChange={(v) => setForm({ service: v as "army" | "marines" })}
              >
                <option value="army">Army</option>
                <option value="marines">Marines</option>
              </FormSelect>
            </FormField>
            <FormField
              label="Combat arm"
              hint="Commando is restricted to Military Academy honors graduates."
            >
              <FormSelect
                value={form.combatArm}
                onChange={(v) => setForm({ combatArm: v })}
              >
                {mercenaryNonCommandoArms(edition).map((arm) => (
                  <option key={arm} value={arm}>
                    {arm}
                  </option>
                ))}
              </FormSelect>
            </FormField>
          </>
        )}

        {acgPathway === "navy" && (
          <>
            <FormField label="Fleet">
              <FormSelect
                value={form.fleet}
                onChange={(v) => setForm({ fleet: v as AcgFormState["fleet"] })}
              >
                {optionDomain(edition, "acg.navy.fleet").values.map((fleet) => (
                  <option key={fleet} value={fleet}>
                    {FLEET_LABELS[fleet] ?? fleet}
                  </option>
                ))}
              </FormSelect>
            </FormField>
            <FormField
              label="Subsector tech code"
              hint="PM p. 52 step 1C: subsector capital's tech. Default falls back to your homeworld tech, clamped to Early Stellar+."
            >
              <FormSelect
                value={form.subsectorTech}
                onChange={(v) => setForm({ subsectorTech: v })}
              >
                <option value="">
                  — default (homeworld tech, clamped to Early Stellar+)
                </option>
                <option value="Early Stellar">Early Stellar</option>
                <option value="Avg Stellar">Avg Stellar</option>
                <option value="High Stellar">High Stellar</option>
              </FormSelect>
            </FormField>
          </>
        )}

        {acgPathway === "scout" && (
          <FormField label="Division">
            <FormSelect
              value={form.division}
              onChange={(v) => setForm({ division: v as "field" | "bureaucracy" })}
            >
              <option value="field">
                Field (Survey, Communications, Exploration)
              </option>
              <option value="bureaucracy">
                Bureaucracy (Technical, Operations, Administration, Detached Duty)
              </option>
            </FormSelect>
          </FormField>
        )}

        {acgPathway === "merchantPrince" && (
          <>
            <FormField label="Line type">
              <FormSelect
                value={form.lineType}
                onChange={(v) => setForm({ lineType: v })}
              >
                <option value="Megacorp">Megacorp (9+, Class B+)</option>
                <option value="Sector-wide">Sector-wide (8+, Class C+)</option>
                <option value="Subsector-wide">Subsector-wide (7+, Class D+)</option>
                <option value="Interface">Interface (7+)</option>
                <option value="Fledgling">Fledgling (7+)</option>
                <option value="Free Trader">Free Trader (7+)</option>
              </FormSelect>
            </FormField>
            {(form.lineType === "Megacorp" || form.lineType === "Sector-wide") && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.merchantAcademy}
                  onChange={(e) => setForm({ merchantAcademy: e.target.checked })}
                  className="mt-0.5"
                />
                <span>
                  <strong className="font-semibold">
                    Apply for Merchant Academy.
                  </strong>{" "}
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    PM p. 47: available only after enlistment in
                    Megacorporation or Sector-wide lines. Honors graduates
                    pick their department and start at rank O1.
                  </span>
                </span>
              </label>
            )}
          </>
        )}
      </div>

      <PrimaryButton onClick={onEnlist}>Enlist →</PrimaryButton>
    </PhaseCard>
  );
}
