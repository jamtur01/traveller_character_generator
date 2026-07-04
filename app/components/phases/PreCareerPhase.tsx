"use client";

import type { Character } from "@/lib/traveller/character";
import {
  isPreCareerEligible, preCareerLabel, preCareerUiSummary,
} from "@/lib/traveller";
import { PhaseCard, PrimaryButton } from "@/app/components/ui";

export type PreCareerOption =
  | "college" | "navalAcademy" | "militaryAcademy" | "merchantAcademy"
  | "medicalSchool" | "flightSchool";

function PreCareerButton({
  label, sub, onClick,
}: { label: string; sub: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md border border-zinc-300 bg-white p-3 text-left text-sm shadow-sm hover:border-emerald-500 hover:bg-emerald-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-emerald-500 dark:hover:bg-zinc-800"
    >
      <div className="font-semibold text-zinc-900 dark:text-zinc-50">{label}</div>
      <div className="text-xs text-zinc-600 dark:text-zinc-400">{sub}</div>
    </button>
  );
}

export function PreCareerPhase({
  character,
  onApply,
}: {
  character: Character;
  onApply: (opt: PreCareerOption | "skip") => void;
}) {
  const attended = character.acgState?.schoolsAttended ?? [];
  const attempted = character.acgState?.schoolsAttempted ?? [];
  const honors = character.acgState?.honorsGraduations ?? [];
  const pathway = character.acgPathway ?? "";
  const has = (k: string) => attended.includes(k);
  const tried = (k: string) => attempted.includes(k);
  const hasHonors = (k: string) => honors.includes(k);
  const navalAcademyGraduated = has("navalAcademy");
  const collegeHonorsCommissioned =
    hasHonors("college") && character.acgState?.preCareerCommission === true;
  // PM p. 47 honors gates:
  //   Medical School: honors from college OR Naval Academy OR Military Academy.
  //   Flight School: commissioned college honors graduate, OR any Naval
  //     Academy graduate, OR commissioned Merchant Academy graduate.
  const medAvailable = !tried("medicalSchool") &&
    (hasHonors("college") || hasHonors("navalAcademy") || hasHonors("militaryAcademy"));
  const flightAvailable = !tried("flightSchool") &&
    (collegeHonorsCommissioned || navalAcademyGraduated ||
     (has("merchantAcademy") && character.acgState?.preCareerCommission === true));
  // PM ACG checklists constrain which schools a pathway includes:
  //   Mercenary: College, Naval Academy, Military Academy, Medical, Flight
  //   Navy:      College, Naval Academy, Medical, Flight
  //   Scout:     College, Medical, Flight (no academies)
  //   Merchant:  College, Medical, Flight (no academies)
  const allowsNavalAcademy = pathway === "mercenary" || pathway === "navy";
  const allowsMilitaryAcademy = pathway === "mercenary";
  const eligible = (opt: PreCareerOption) => isPreCareerEligible(character, opt);
  const eid = character.editionId;
  return (
    <PhaseCard
      title="Pre-career education (optional)"
      subtitle="College, service academies, medical, and flight school. Each option ages you and may grant skills, attributes, brownie points, or auto-enlist. Academy honors graduates may chain into Medical or Flight School. Skip to proceed straight to enlistment."
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {!tried("college") && eligible("college") && (
          <PreCareerButton
            label={preCareerLabel("college", eid)}
            sub={preCareerUiSummary(eid, "college")}
            onClick={() => onApply("college")}
          />
        )}
        {allowsNavalAcademy && !tried("navalAcademy") && eligible("navalAcademy") && (
          <PreCareerButton
            label={preCareerLabel("navalAcademy", eid)}
            sub={preCareerUiSummary(eid, "navalAcademy")}
            onClick={() => onApply("navalAcademy")}
          />
        )}
        {allowsMilitaryAcademy && !tried("militaryAcademy") && eligible("militaryAcademy") && (
          <PreCareerButton
            label={preCareerLabel("militaryAcademy", eid)}
            sub={preCareerUiSummary(eid, "militaryAcademy")}
            onClick={() => onApply("militaryAcademy")}
          />
        )}
        {medAvailable && eligible("medicalSchool") && (
          <PreCareerButton
            label={preCareerLabel("medicalSchool", eid)}
            sub={preCareerUiSummary(eid, "medicalSchool")}
            onClick={() => onApply("medicalSchool")}
          />
        )}
        {flightAvailable && eligible("flightSchool") && (
          <PreCareerButton
            label={preCareerLabel("flightSchool", eid)}
            sub={preCareerUiSummary(eid, "flightSchool")}
            onClick={() => onApply("flightSchool")}
          />
        )}
      </div>
      <PrimaryButton onClick={() => onApply("skip")}>
        Skip pre-career → enlistment
      </PrimaryButton>
      {attended.length > 0 && (
        <div className="text-xs text-zinc-600 dark:text-zinc-400">
          Already attended: {attended.join(", ")}
        </div>
      )}
    </PhaseCard>
  );
}
