// Basic-chargen enlistment: pick a service (or accept the player's
// choice), roll, draft on failure, apply service skills + homeworld
// skills. Also ACG enlistment entry (beginAcg) — initializes acgState
// and runs pathway-specific enlistment.

import type { Character } from "@/lib/traveller/character";
import { getEdition } from "@/lib/traveller/editions";
import { arnd, roll } from "@/lib/traveller/random";
import { event as ev } from "@/lib/traveller/history";
import type { ServiceKey, AttributeKey } from "@/lib/traveller/types";
import type { ServiceData } from "@/lib/traveller/editions/types";
import {
  getDraftServices, getEnlistableServices,
} from "@/lib/traveller/services";
import {
  applyHomeworldSkills, availableServicesForHomeworld,
} from "@/lib/traveller/engine/homeworld";
import { ChoicePendingError } from "@/lib/traveller/engine/choices";
import { mercenaryEnlist } from "@/lib/traveller/engine/acg/pathways/mercenary";
import { navyEnlist } from "@/lib/traveller/engine/acg/pathways/navy";
import { scoutEnlist } from "@/lib/traveller/engine/acg/pathways/scout";
import { merchantEnlist } from "@/lib/traveller/engine/acg/pathways/merchantPrince";

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
    options = { ...options, fleet: options.fleet ?? "imperialNavy" };
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

  ch.acgState = {
    pathway: effPathway,
    rankCode: hasCommission ? prev!.rankCode : "E1",
    isOfficer: hasCommission ? prev!.isOfficer : false,
    year: 1,
    currentAssignment: null,
    inCommand: false,
    justRetained: false,
    retainedAssignment: null,
    promotedThisTerm: false,
    injuredThisYear: false,
    assignmentHistory: [],
    combatRibbons: 0,
    commandClusters: 0,
    schoolsAttended: prev?.schoolsAttended ? [...prev.schoolsAttended] : [],
    decorations: prev?.decorations ? [...prev.decorations] : [],
    browniePoints: prev?.browniePoints ?? 0,
    browniePointsSpent: prev?.browniePointsSpent ?? 0,
    decorationDmStrategy: 0,
    ...(prev?.honorsGraduations ? { honorsGraduations: [...prev.honorsGraduations] } : {}),
    ...(hasCommission ? { preCareerCommission: true } : {}),
    ...(prev?.preCareerBranch !== undefined ? { preCareerBranch: prev.preCareerBranch } : {}),
    ...(prev?.preCareerFirstTermShort ? { preCareerFirstTermShort: true } : {}),
    ...(prev?.preCareerDraftedInto ? { preCareerDraftedInto: prev.preCareerDraftedInto } : {}),
    ...(prev?.attemptMerchantAcademy !== undefined
      ? { attemptMerchantAcademy: prev.attemptMerchantAcademy } : {}),
  };
  if (hasCommission) ch.commissioned = true;
  if (draft) {
    ch.drafted = true;
    ch.log(ev.drafted(`${ch.service} (pre-career failure)`));
  }
  // Navy: record subsector tech code (PM p. 52). Default: homeworld tech,
  // clamped to Early Stellar minimum.
  if (pathway === "navy") {
    const homeworldTech = ch.homeworld?.tech;
    const order = (getEdition(ch.editionId).data as {
      homeworld?: { techCodeOrder?: string[] };
    }).homeworld?.techCodeOrder ?? [];
    let subsectorTech = options.subsectorTechCode ?? homeworldTech;
    const earlyIdx = order.indexOf("Early Stellar");
    if (subsectorTech && order.length > 0 && earlyIdx >= 0) {
      const idx = order.indexOf(subsectorTech);
      if (idx < earlyIdx) subsectorTech = "Early Stellar";
    }
    if (subsectorTech) ch.acgState.subsectorTechCode = subsectorTech;
  }
  // Interactive-mode enlistment may queue a player choice (Navy Soc 9+
  // branch pick, scout admin DM, etc.); swallow ChoicePendingError so
  // the character's pendingChoices stand. The UI resolves them and the
  // pause-and-resume machinery in runAcgYear handles subsequent flow.
  try {
    switch (effPathway) {
      case "mercenary":
        mercenaryEnlist(ch, options.service ?? "army", options.combatArm ?? "Infantry");
        break;
      case "navy":
        navyEnlist(ch, options.fleet ?? "imperialNavy");
        break;
      case "scout":
        ch.acgState.division = options.division ?? "field";
        scoutEnlist(ch);
        break;
      case "merchantPrince":
        merchantEnlist(ch, options.lineType ?? "Free Trader");
        break;
    }
  } catch (err) {
    if (!(err instanceof ChoicePendingError)) throw err;
    // Pending choice queued — UI will resolve it.
  }
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
  if (gated.length === 0) gated = enlistable;
  let preferredService: ServiceKey;
  if (method && method !== "random") {
    preferredService = method as ServiceKey;
    if (ch.homeworld && !gated.includes(preferredService)) {
      ch.log(ev.enlistmentAttempt(
        preferredService, 0, 0, 0, false,
        `homeworld tech ${ch.homeworld.tech} forbids`,
      ));
      preferredService = arnd(gated);
    }
  } else {
    preferredService = arnd(gated);
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
        "distinguished by social standing (Soc 10+, auto-enrolled)",
      ));
      applyServiceStartAge(ch, "nobles");
      ch.service = "nobles";
      if (ch.homeworld) applyHomeworldSkills(ch, ch.homeworld);
      const skills = ch.editionService("nobles").getServiceSkills(ch);
      for (const sk of skills) ch.addSkill(sk, 1, "Nobility service skill");
      return "nobles";
    }
  }

  const pref = ch.editionService(preferredService);
  const dm = pref.enlistmentDM(ch.attributes);
  const en = roll(2);
  const succeeded = en + dm >= pref.enlistmentThrow;
  ch.log(ev.enlistmentAttempt(
    pref.serviceName, en, dm, pref.enlistmentThrow, succeeded,
  ));
  if (succeeded) {
    applyServiceStartAge(ch, preferredService);
    ch.service = preferredService;
    if (ch.homeworld) applyHomeworldSkills(ch, ch.homeworld);
    const skills = pref.getServiceSkills(ch);
    for (const sk of skills) ch.addSkill(sk, 1, `${pref.serviceName} service skill`);
    return preferredService;
  }
  ch.drafted = true;
  // Defensive: if no draft pool is registered for the edition, fall
  // back to the gated enlistable list so the draft doesn't crash on
  // arnd of an empty array.
  const effDraftPool = draftPool.length > 0 ? draftPool : gated;
  const draftService = arnd(effDraftPool);
  ch.log(ev.drafted(draftService));
  applyServiceStartAge(ch, draftService);
  ch.service = draftService;
  if (ch.homeworld) applyHomeworldSkills(ch, ch.homeworld);
  const draftDef = ch.editionService(draftService);
  const skills = draftDef.getServiceSkills(ch);
  for (const sk of skills) ch.addSkill(sk, 1, `${draftDef.serviceName} service skill`);
  return draftService;
}
