// Basic-chargen enlistment: pick a service (or accept the player's
// choice), roll, draft on failure, apply service skills + homeworld
// skills. ACG enlistment is handled by the ACG runner separately.

import type { Character } from "../character";
import { getEdition } from "../editions";
import { arnd, roll } from "../random";
import { event as ev } from "../history";
import type { ServiceKey } from "../types";
import {
  getDraftServices, getEnlistableServices,
} from "../services";
import {
  applyHomeworldSkills, availableServicesForHomeworld,
} from "../engine/homeworld";

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
  // CT returns the full list unchanged).
  const gated = ch.homeworld
    ? availableServicesForHomeworld(ch, ch.homeworld, enlistable)
    : enlistable;
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

  // CotI: Soc 10+ characters are automatically enrolled in the Nobility.
  if (ch.attributes.social >= 10 && (!method || method === "random")) {
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
  const draftService = arnd(draftPool);
  ch.log(ev.drafted(draftService));
  applyServiceStartAge(ch, draftService);
  ch.service = draftService;
  if (ch.homeworld) applyHomeworldSkills(ch, ch.homeworld);
  const draftDef = ch.editionService(draftService);
  const skills = draftDef.getServiceSkills(ch);
  for (const sk of skills) ch.addSkill(sk, 1, `${draftDef.serviceName} service skill`);
  return draftService;
}
