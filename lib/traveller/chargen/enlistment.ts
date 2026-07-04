// Basic-chargen enlistment: pick a service (or accept the player's
// choice), roll, draft on failure, apply service skills + homeworld
// skills. Also ACG enlistment entry (beginAcg) — initializes acgState
// and runs pathway-specific enlistment.

import type { Character } from "@/lib/traveller/character";
import { getEdition } from "@/lib/traveller/editions";
import { event as ev } from "@/lib/traveller/history";
import type { ServiceKey, AttributeKey } from "@/lib/traveller/types";
import type { ServiceData } from "@/lib/traveller/editions/types";
import {
  getDraftServices, getEnlistableServices,
} from "@/lib/traveller/services";
import {
  applyHomeworldSkills, availableServicesForHomeworld,
} from "@/lib/traveller/engine/homeworld";
import { pauseGuard } from "@/lib/traveller/engine/choices";
import { mercenaryEnlist } from "@/lib/traveller/engine/acg/pathways/mercenary";
import { navyEnlist, navyDraftFleetKey } from "@/lib/traveller/engine/acg/pathways/navy";
import { scoutEnlist } from "@/lib/traveller/engine/acg/pathways/scout";
import { merchantEnlist } from "@/lib/traveller/engine/acg/pathways/merchantPrince";
import { freshAcgState } from "@/lib/traveller/engine/acg/state";
import { attrShort } from "@/lib/traveller/formatting";
import { requireRule } from "@/lib/traveller/editions/strict";

/** Options for beginAcg — pathway-specific enlistment parameters. */
export interface BeginAcgOptions {
  combatArm?: string;
  service?: "army" | "marines";
  fleet?: "imperialNavy" | "reserveFleet" | "systemSquadron";
  division?: "field" | "bureaucracy";
  lineType?: string;
  /** Subsector tech code (PM p. 52: Navy characters must know this).
   *  Defaults to homeworld tech, clamped to Early Stellar minimum. */
  subsectorTechCode?: string;
}

/** Begin Advanced Character Generation. Initializes acgState for the
 *  chosen pathway and runs pathway-specific enlistment with the
 *  pathway-appropriate options. After this call, subsequent
 *  doServiceTermStep() invocations run the ACG per-year cycle. */
export function beginAcg(
  ch: Character,
  pathway: "mercenary" | "navy" | "scout" | "merchantPrince",
  options: BeginAcgOptions = {},
): void {
  ch.useAcg = true;
  const prev = ch.acgState;
  const hasCommission = prev?.preCareerCommission === true;

  // Rrev2: pre-career failure may force the character into a specific
  // service (PM p. 47). Override the user's pathway/options when a
  // draft is pending.
  let effPathway = pathway;
  const draft = prev?.preCareerDraftedInto;
  if (draft === "navy") {
    effPathway = "navy";
    // Wash-out draftees serve in the JSON-declared draft fleet (PM p. 47 +
    // p. 52) — derived from acg.navy.enlistment.draft.results, not a literal.
    options = { ...options, fleet: options.fleet ?? navyDraftFleetKey(ch.editionId) };
  } else if (draft === "army") {
    effPathway = "mercenary";
    options = { ...options, service: "army" };
  } else if (draft === "marines") {
    effPathway = "mercenary";
    options = { ...options, service: "marines" };
  }
  ch.acgPathway = effPathway;

  // Rrev6: set ch.service BEFORE the pathway-specific enlistment runs.
  // Pathway enlist functions can queue interactive choices, throwing
  // ChoicePendingError; if service is set after, the character is left
  // with service="other" while acgState says e.g. "navy". Order matters.
  if (effPathway === "mercenary") {
    ch.service = (options.service === "marines" ? "marines" : "army") as ServiceKey;
  } else if (effPathway === "navy") {
    ch.service = "navy" as ServiceKey;
  } else if (effPathway === "scout") {
    ch.service = "scouts" as ServiceKey;
  } else if (effPathway === "merchantPrince") {
    ch.service = "merchants" as ServiceKey;
  }

  const acg = freshAcgState(effPathway);
  if (hasCommission) {
    acg.rankCode = prev!.rankCode;
    acg.isOfficer = prev!.isOfficer;
    acg.preCareerCommission = true;
  }
  if (prev?.schoolsAttended) acg.schoolsAttended = [...prev.schoolsAttended];
  if (prev?.decorations) acg.decorations = [...prev.decorations];
  acg.browniePoints = prev?.browniePoints ?? 0;
  acg.browniePointsSpent = prev?.browniePointsSpent ?? 0;
  if (prev?.honorsGraduations) acg.honorsGraduations = [...prev.honorsGraduations];
  if (prev?.preCareerBranch !== undefined) acg.preCareerBranch = prev.preCareerBranch;
  if (prev?.preCareerFirstTermShort) acg.preCareerFirstTermShort = true;
  if (prev?.preCareerDraftedInto) acg.preCareerDraftedInto = prev.preCareerDraftedInto;
  if (prev?.attemptMerchantAcademy !== undefined) {
    acg.attemptMerchantAcademy = prev.attemptMerchantAcademy;
  }
  ch.acgState = acg;
  if (hasCommission) ch.commissioned = true;
  if (draft) {
    ch.drafted = true;
    ch.log(ev.drafted(`${ch.service} (pre-career failure)`));
  }
  if (pathway === "navy") recordNavySubsectorTech(ch, options);
  // Interactive-mode enlistment may queue a player choice (Navy Soc 9+
  // branch pick, scout admin DM, etc.); swallow ChoicePendingError so
  // the character's pendingChoices stand. The UI resolves them and the
  // pause-and-resume machinery in runAcgYear handles subsequent flow.
  // The `??` defaults below are API-surface conveniences (auto flows and
  // tests that don't present a picker), each mirroring the first printed
  // option of its table; the UI and RunLog always pass explicit values.
  pauseGuard(() => {
    switch (effPathway) {
      case "mercenary":
        mercenaryEnlist(ch, options.service ?? "army", options.combatArm ?? "Infantry");
        break;
      case "navy":
        navyEnlist(ch, options.fleet ?? "imperialNavy");
        break;
      case "scout":
        ch.requireScoutAcg().division = options.division ?? "field";
        scoutEnlist(ch);
        break;
      case "merchantPrince":
        merchantEnlist(ch, options.lineType ?? "Free Trader");
        break;
    }
  });
}

/** Navy: record the subsector tech code (PM p. 52). Default: homeworld
 *  tech (or the caller-supplied code), floored at the JSON-declared
 *  minimum (acg.navy.enlistment.subsectorTechMinimum). */
function recordNavySubsectorTech(ch: Character, options: BeginAcgOptions): void {
  const homeworldTech = ch.homeworld?.tech;
  const order = getEdition(ch.editionId).data.homeworld?.techCodeOrder ?? [];
  let subsectorTech = options.subsectorTechCode ?? homeworldTech;
  if (subsectorTech && order.length > 0) {
    const minTech = requireRule(
      getEdition(ch.editionId).data.advancedCharacterGeneration
        ?.navy?.enlistment.subsectorTechMinimum,
      "acg.navy.enlistment.subsectorTechMinimum", "PM p. 52",
    );
    const minIdx = order.indexOf(minTech);
    if (minIdx < 0) {
      throw new Error(
        `homeworld.techCodeOrder does not contain "${minTech}" ` +
        `(acg.navy.enlistment.subsectorTechMinimum) — fix the edition JSON`,
      );
    }
    if (order.indexOf(subsectorTech) < minIdx) subsectorTech = minTech;
  }
  if (subsectorTech) ch.requireAcgState().subsectorTechCode = subsectorTech;
}

/** Apply the joined service's startAge from edition data. */
export function applyServiceStartAge(ch: Character, svc: ServiceKey): void {
  const edition = getEdition(ch.editionId);
  const data = edition.data.services[svc];
  if (data?.startAge !== undefined) ch.age = data.startAge;
}

/** Basic-chargen enlistment. Returns the service the character ended
 *  up in (their preferred service if accepted, otherwise the draft
 *  pool's random pick). Throws if invoked on an ACG character — those
 *  go through the ACG runner instead. */
export function doEnlistment(ch: Character, method: string): ServiceKey {
  const enlistable = getEnlistableServices(ch.editionId);
  const draftPool = getDraftServices(ch.editionId);
  if (ch.useAcg) {
    throw new Error(
      "doEnlistment is for basic chargen only; ACG characters should use the ACG runner",
    );
  }
  // Gate the enlistable list by homeworld tech / social rules (MT only;
  // CT returns the full list unchanged). If the homeworld's restrictions
  // somehow filter every service out, fall back to the ungated list so
  // arnd doesn't crash on an empty pool.
  let gated = ch.homeworld
    ? availableServicesForHomeworld(ch, ch.homeworld, enlistable)
    : enlistable;
  if (gated.length === 0) {
    // JSON-declared homeworld gates excluded every service. Fall back to the
    // ungated list so the character stays playable, but record the waiver
    // loudly in the history instead of silently disabling declared gates.
    ch.log(ev.enlistmentAttempt(
      "any service", 0, 0, 0, false,
      `homeworld gates excluded all services — gate waived (tech ${ch.homeworld?.tech ?? "?"})`,
    ));
    gated = enlistable;
  }
  let preferredService: ServiceKey;
  if (method && method !== "random") {
    preferredService = method as ServiceKey;
    if (ch.homeworld && !gated.includes(preferredService)) {
      ch.log(ev.enlistmentAttempt(
        preferredService, 0, 0, 0, false,
        `homeworld tech ${ch.homeworld.tech} forbids`,
      ));
      preferredService = ch.rng.pick(gated);
    }
  } else {
    preferredService = ch.rng.pick(gated);
  }

  // CotI: characters whose social standing (or other attribute) meets the
  // nobles service's enlistment.automaticIf threshold are automatically
  // enrolled in the Nobility. Editions without a nobles service, or whose
  // nobles service has no automaticIf rule, skip this branch entirely.
  const noblesData: ServiceData | undefined =
    getEdition(ch.editionId).data.services.nobles;
  const autoIf = noblesData?.checks.enlistment.automaticIf;
  if (autoIf && (!method || method === "random")) {
    const attrVal = ch.attributes[autoIf.attribute as AttributeKey] ?? 0;
    if (attrVal >= autoIf.min) {
      ch.log(ev.enlistmentAttempt(
        "Nobility", 0, 0, 0, true,
        `distinguished by social standing (${attrShort(autoIf.attribute as AttributeKey)} ${autoIf.min}+, auto-enrolled)`,
      ));
      applyServiceStartAge(ch, "nobles");
      ch.service = "nobles";
      if (ch.homeworld) applyHomeworldSkills(ch);
      const skills = ch.editionService("nobles").getServiceSkills(ch);
      for (const sk of skills) ch.addSkill(sk, 1, "Nobility service skill");
      return "nobles";
    }
  }

  const pref = ch.editionService(preferredService);
  const dm = pref.enlistmentDM(ch.attributes);
  const en = ch.rng.roll(2);
  const succeeded = en + dm >= pref.enlistmentThrow;
  ch.log(ev.enlistmentAttempt(
    pref.serviceName, en, dm, pref.enlistmentThrow, succeeded,
  ));
  if (succeeded) {
    applyServiceStartAge(ch, preferredService);
    ch.service = preferredService;
    if (ch.homeworld) applyHomeworldSkills(ch);
    const skills = pref.getServiceSkills(ch);
    for (const sk of skills) ch.addSkill(sk, 1, `${pref.serviceName} service skill`);
    return preferredService;
  }
  ch.drafted = true;
  // Defensive: if no draft pool is registered for the edition, fall
  // back to the gated enlistable list so the draft doesn't crash on
  // arnd of an empty array.
  const effDraftPool = draftPool.length > 0 ? draftPool : gated;
  const draftService = ch.rng.pick(effDraftPool);
  ch.log(ev.drafted(draftService));
  applyServiceStartAge(ch, draftService);
  ch.service = draftService;
  if (ch.homeworld) applyHomeworldSkills(ch);
  const draftDef = ch.editionService(draftService);
  const skills = draftDef.getServiceSkills(ch);
  for (const sk of skills) ch.addSkill(sk, 1, `${draftDef.serviceName} service skill`);
  return draftService;
}
