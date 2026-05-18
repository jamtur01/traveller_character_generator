// Structured event log for character generation.
//
// Every meaningful chargen event (homeworld roll, skill grant, enlistment
// roll, decoration award, muster benefit, etc.) is recorded as a typed
// HistoryEvent. The engine emits events; UI / sheet renderers consume them.
//
// Why structured: a plain string history is fine for display, but anything
// that wants to *do* something with it (filter to "rolls only", group by
// term, render skills as a bulleted list, export to JSON for a campaign
// log) has to parse the strings. Typed events let consumers stay in
// structured-data land.
//
// `raw` event kind: wraps an arbitrary string for narrative lines that
// are inherently free-text (data-driven `historyLine` rules from the
// edition JSON, freeTrader pursuit prose) and don't merit their own
// typed kind. All other chargen logging flows through typed constructors.
//
// Verbosity: the event's `level` field ("simple" | "verbose" | "debug")
// drives whether a given UI mode renders it. Equivalent to the existing
// history / verboseHistory / debugHistory split, but stored on the event
// so the consumer decides at render time instead of the engine deciding
// at log time.

export type HistoryLevel = "simple" | "verbose" | "debug";

// All event kinds the engine may emit. Adding a kind: append here, add a
// constructor, handle it in formatEvent.
export type HistoryEvent =
  // Catch-all string event. Used for raw `history.push` calls that
  // haven't been migrated to a typed event yet.
  | { kind: "raw"; level: HistoryLevel; text: string }
  // Section breaks the user sees in the history panel (term boundaries,
  // muster-out start, end of generation).
  | { kind: "section"; level: HistoryLevel; label: string }
  // Homeworld determined.
  | {
      kind: "homeworld";
      level: HistoryLevel;
      starport: string; size: string; atmosphere: string;
      hydrosphere: string; population: string; law: string; tech: string;
    }
  // Attribute changed (aging, skill grant, +1 cell, anagathics).
  | {
      kind: "attributeChange";
      level: HistoryLevel;
      attribute: string; delta: number; reason?: string;
    }
  // Skill learned at some level.
  | {
      kind: "skillLearned";
      level: HistoryLevel;
      skill: string; skillLevel: number; source?: string;
    }
  // Skill improved (already known, level bumped).
  | {
      kind: "skillImproved";
      level: HistoryLevel;
      skill: string; skillLevel: number; source?: string;
    }
  // Skill cap (Int+Edu) reduction.
  | {
      kind: "skillReduced";
      level: HistoryLevel;
      skill: string; skillLevel: number; reason: string;
    }
  | {
      kind: "skillForfeited";
      level: HistoryLevel;
      skill: string; reason: string;
    }
  // Player picked an option from a cascade (e.g., Blade Combat → Cutlass).
  | {
      kind: "cascadePick";
      level: HistoryLevel;
      cascade: string; chosen: string;
    }
  // Enlistment attempt. `note` carries pathway-specific detail or gate
  // reasons (e.g., "homeworld tech forbids", "auto-enlistment").
  | {
      kind: "enlistmentAttempt";
      level: HistoryLevel;
      service: string; roll: number; dm: number; target: number;
      succeeded: boolean;
      note?: string;
    }
  // Drafted into a service (after failed enlistment).
  | { kind: "drafted"; level: HistoryLevel; service: string }
  // Term begins.
  | {
      kind: "termBegin";
      level: HistoryLevel;
      termNumber: number; age: number;
      shortTerm?: boolean; shortTermReason?: string;
    }
  // Survival / commission / promotion / special duty roll.
  | {
      kind: "roll";
      level: HistoryLevel;
      rollName: string; roll: number; dm: number; target: number;
      succeeded: boolean; context?: string;
    }
  // Decoration award (MCUF / MCG / SEH / Purple Heart).
  | { kind: "decoration"; level: HistoryLevel; award: string; reason?: string }
  // Court-martial result.
  | { kind: "courtMartial"; level: HistoryLevel; result: string }
  // Reenlistment outcome.
  | {
      kind: "reenlistment";
      level: HistoryLevel;
      outcome: "voluntary" | "mandatory" | "denied" | "retired" | "released" | "heldOver";
      roll?: number; target?: number; reason?: string;
    }
  // Mustering-out benefit roll. `benefit` is omitted when the roll lands
  // outside the 1-7 cell range or hits a null cell — outcome captures why.
  | {
      kind: "musterBenefit";
      level: HistoryLevel;
      benefit?: string; tableRoll: number; dm: number;
      outcome?: "outOfRange" | "noBenefit";
    }
  // Mortgage paydown from a repeat ship benefit (PM p. 17 — Free Trader,
  // Seeker, Yacht, Lab Ship, Safari Ship: each repeat receipt cancels a
  // fixed number of mortgage years).
  | {
      kind: "mortgagePayoff";
      level: HistoryLevel;
      ship: string; years: number;
    }
  // Resolution produced no state change. Used by cell resolution for
  // repeat receipts of non-stackable benefits (Watch / Instruments / a
  // ship already owned at zero mortgage). Debug-level only.
  | {
      kind: "noEffect";
      level: HistoryLevel;
      reason: string;
    }
  // Cash awarded — muster-out cash roll, or in-service bonus (Merchant
  // Bonus per PM p. 60). `source` describes which path produced the cash.
  | {
      kind: "musterCash";
      level: HistoryLevel;
      amount: number; tableRoll: number; dm: number;
      source?: string;
    }
  // Brownie-point award / spend.
  | {
      kind: "browniePoint";
      level: HistoryLevel;
      delta: number; reason: string; balance: number;
    }
  // Anagathics availability outcome.
  | {
      kind: "anagathics";
      level: HistoryLevel;
      outcome: "found" | "lost" | "withdrawal" | "unavailable";
      roll?: number; target?: number;
    }
  // Aging save (per attribute, per term). Anagathics auto-saves emit
  // outcome "auto" without dice; normal aging emits "passed"/"failed"
  // with the two 2D rolls and the save target. The downstream
  // ev.attributeChange (only fires on failure) records the actual delta.
  | {
      kind: "agingSave";
      level: HistoryLevel;
      attribute: string;
      outcome: "auto" | "passed" | "failed";
      dice?: [number, number]; save?: number;
    }
  // Pre-career attempt.
  | {
      kind: "preCareer";
      level: HistoryLevel;
      option: string;
      result: "denied" | "washedOut" | "graduated" | "honors" | "info";
      note?: string;
    }
  // Character ended generation (died, mustered, retired).
  | {
      kind: "endGeneration";
      level: HistoryLevel;
      reason: "mustered" | "deceased" | "retired";
      note?: string;
    }
  // Marine Tradition fired (PM p. 49). The save either passed (player
  // gets the cascade as normal) or failed (forced to Large Blade).
  | {
      kind: "marineTradition";
      level: HistoryLevel;
      outcome: "saved" | "forced";
      forcedSkill?: string;
      roll?: number; dm?: number; target?: number;
    }
  // ACG year began with a specific assignment rolled.
  | {
      kind: "assignmentRolled";
      level: HistoryLevel;
      assignment: string; term?: number; year?: number;
      retained?: boolean; note?: string;
    }
  // Bonus skill point granted when a roll exceeds its target by the
  // configured overshoot threshold (PM commission/promotion/special-duty
  // double bonus).
  | {
      kind: "bonusSkillPoint";
      level: HistoryLevel;
      source: string; overshoot: number;
    }
  // ACG officer command-duty roll outcome.
  | {
      kind: "commandDuty";
      level: HistoryLevel;
      inCommand: boolean; roll: number; dm: number; target: number;
    }
  // ACG school assignment (Scout school, Mercenary specialist school,
  // etc.). Skills earned by attendance are logged separately as
  // skillLearned events.
  | {
      kind: "schoolAssigned";
      level: HistoryLevel;
      school: string; pathway?: string;
    }
  // Character was promoted into a new rank.
  | {
      kind: "promoted";
      level: HistoryLevel;
      rank: string; source?: string;
    }
  // Career-altering status change that does NOT end chargen. Examples:
  // Dishonorable Discharge (continues to muster-out with -3 rolls),
  // jail time within a term that consumes one year of service.
  | {
      kind: "statusChange";
      level: HistoryLevel;
      kind_:
        | "dishonorablyDischarged" | "jailed" | "pensionForfeit"
        | "purpleHeart" | "demoted" | "ocsDenied" | "ocsWaiver"
        | "shortTerm" | "revived" | "promotionSkipped" | "commissionSkipped"
        | "voluntaryMuster" | "schoolDenied";
      note?: string;
    }
  // Cross-training: school grants ELIGIBILITY for branch/arm change. The
  // actual reenlist-time switch fires an ev.transferred, not crossTrained.
  | {
      kind: "crossTrained";
      level: HistoryLevel;
      destination: string; kind_: "combatArm" | "branch";
    }
  // Mid-career transfer (Merchant Prince line transfer, Scout division
  // transfer, etc.).
  | {
      kind: "transferred";
      level: HistoryLevel;
      from?: string; to: string;
      kind_: "department" | "division" | "line" | "fleet" | "branch" | "combatArm";
      reason?: string;
    };

/** Constructors for the most common events. UI / engine emit via these
 *  to keep callsites uncluttered. */
export const event = {
  raw: (text: string, level: HistoryLevel = "simple"): HistoryEvent =>
    ({ kind: "raw", level, text }),
  section: (label: string, level: HistoryLevel = "verbose"): HistoryEvent =>
    ({ kind: "section", level, label }),
  homeworld: (
    starport: string, size: string, atmosphere: string,
    hydrosphere: string, population: string, law: string, tech: string,
  ): HistoryEvent => ({
    kind: "homeworld", level: "simple",
    starport, size, atmosphere, hydrosphere, population, law, tech,
  }),
  skillLearned: (skill: string, skillLevel: number, source?: string): HistoryEvent => ({
    kind: "skillLearned", level: "simple", skill, skillLevel,
    ...(source !== undefined ? { source } : {}),
  }),
  skillImproved: (skill: string, skillLevel: number, source?: string): HistoryEvent => ({
    kind: "skillImproved", level: "simple", skill, skillLevel,
    ...(source !== undefined ? { source } : {}),
  }),
  attributeChange: (attribute: string, delta: number, reason?: string): HistoryEvent => ({
    kind: "attributeChange", level: "simple", attribute, delta,
    ...(reason !== undefined ? { reason } : {}),
  }),
  cascadePick: (cascade: string, chosen: string): HistoryEvent => ({
    kind: "cascadePick", level: "simple", cascade, chosen,
  }),
  musterBenefit: (
    benefit: string | undefined, tableRoll: number, dm: number,
    outcome?: "outOfRange" | "noBenefit",
  ): HistoryEvent => ({
    kind: "musterBenefit", level: "simple", tableRoll, dm,
    ...(benefit !== undefined ? { benefit } : {}),
    ...(outcome !== undefined ? { outcome } : {}),
  }),
  mortgagePayoff: (ship: string, years: number): HistoryEvent => ({
    kind: "mortgagePayoff", level: "simple", ship, years,
  }),
  noEffect: (reason: string): HistoryEvent => ({
    kind: "noEffect", level: "simple", reason,
  }),
  musterCash: (
    amount: number, tableRoll: number, dm: number, source?: string,
  ): HistoryEvent => ({
    kind: "musterCash", level: "simple", amount, tableRoll, dm,
    ...(source !== undefined ? { source } : {}),
  }),
  skillReduced: (skill: string, lvl: number, reason: string): HistoryEvent => ({
    kind: "skillReduced", level: "simple", skill, skillLevel: lvl, reason,
  }),
  skillForfeited: (skill: string, reason: string): HistoryEvent => ({
    kind: "skillForfeited", level: "simple", skill, reason,
  }),
  enlistmentAttempt: (
    service: string, roll: number, dm: number, target: number, succeeded: boolean,
    note?: string,
  ): HistoryEvent => ({
    kind: "enlistmentAttempt", level: "simple",
    service, roll, dm, target, succeeded,
    ...(note !== undefined ? { note } : {}),
  }),
  drafted: (service: string): HistoryEvent => ({
    kind: "drafted", level: "simple", service,
  }),
  termBegin: (
    termNumber: number, age: number,
    extras?: { shortTerm?: boolean; shortTermReason?: string },
  ): HistoryEvent => ({
    kind: "termBegin", level: "simple", termNumber, age,
    ...(extras?.shortTerm !== undefined ? { shortTerm: extras.shortTerm } : {}),
    ...(extras?.shortTermReason !== undefined
      ? { shortTermReason: extras.shortTermReason } : {}),
  }),
  roll: (
    rollName: string, roll: number, dm: number, target: number,
    succeeded: boolean, context?: string,
  ): HistoryEvent => ({
    kind: "roll", level: "verbose",
    rollName, roll, dm, target, succeeded,
    ...(context !== undefined ? { context } : {}),
  }),
  decoration: (award: string, reason?: string): HistoryEvent => ({
    kind: "decoration", level: "simple", award,
    ...(reason !== undefined ? { reason } : {}),
  }),
  courtMartial: (result: string): HistoryEvent => ({
    kind: "courtMartial", level: "simple", result,
  }),
  reenlistment: (
    outcome: "voluntary" | "mandatory" | "denied" | "retired" | "released" | "heldOver",
    roll?: number, target?: number, reason?: string,
  ): HistoryEvent => ({
    kind: "reenlistment", level: "simple", outcome,
    ...(roll !== undefined ? { roll } : {}),
    ...(target !== undefined ? { target } : {}),
    ...(reason !== undefined ? { reason } : {}),
  }),
  browniePoint: (
    delta: number, reason: string, balance: number,
  ): HistoryEvent => ({
    kind: "browniePoint", level: "simple", delta, reason, balance,
  }),
  agingSave: (
    attribute: string,
    outcome: "auto" | "passed" | "failed",
    extras?: { dice?: [number, number]; save?: number },
  ): HistoryEvent => ({
    kind: "agingSave", level: "verbose", attribute, outcome,
    ...(extras?.dice ? { dice: extras.dice } : {}),
    ...(extras?.save !== undefined ? { save: extras.save } : {}),
  }),
  anagathics: (
    outcome: "found" | "lost" | "withdrawal" | "unavailable",
    roll?: number, target?: number,
  ): HistoryEvent => ({
    kind: "anagathics", level: "simple", outcome,
    ...(roll !== undefined ? { roll } : {}),
    ...(target !== undefined ? { target } : {}),
  }),
  preCareer: (
    option: string,
    result: "denied" | "washedOut" | "graduated" | "honors" | "info",
    note?: string,
  ): HistoryEvent => ({
    kind: "preCareer", level: "simple", option, result,
    ...(note !== undefined ? { note } : {}),
  }),
  endGeneration: (
    reason: "mustered" | "deceased" | "retired",
    note?: string,
  ): HistoryEvent => ({
    kind: "endGeneration", level: "simple", reason,
    ...(note !== undefined ? { note } : {}),
  }),
  marineTradition: (
    outcome: "saved" | "forced",
    extras?: { forcedSkill?: string; roll?: number; dm?: number; target?: number },
  ): HistoryEvent => ({
    kind: "marineTradition", level: "simple", outcome,
    ...(extras?.forcedSkill !== undefined ? { forcedSkill: extras.forcedSkill } : {}),
    ...(extras?.roll !== undefined ? { roll: extras.roll } : {}),
    ...(extras?.dm !== undefined ? { dm: extras.dm } : {}),
    ...(extras?.target !== undefined ? { target: extras.target } : {}),
  }),
  assignmentRolled: (
    assignment: string, term?: number, year?: number,
    retained?: boolean, note?: string,
  ): HistoryEvent => ({
    kind: "assignmentRolled", level: "simple", assignment,
    ...(term !== undefined ? { term } : {}),
    ...(year !== undefined ? { year } : {}),
    ...(retained !== undefined ? { retained } : {}),
    ...(note !== undefined ? { note } : {}),
  }),
  bonusSkillPoint: (source: string, overshoot: number): HistoryEvent => ({
    kind: "bonusSkillPoint", level: "verbose", source, overshoot,
  }),
  commandDuty: (
    inCommand: boolean, roll: number, dm: number, target: number,
  ): HistoryEvent => ({
    kind: "commandDuty", level: "verbose", inCommand, roll, dm, target,
  }),
  schoolAssigned: (school: string, pathway?: string): HistoryEvent => ({
    kind: "schoolAssigned", level: "simple", school,
    ...(pathway !== undefined ? { pathway } : {}),
  }),
  promoted: (rank: string, source?: string): HistoryEvent => ({
    kind: "promoted", level: "simple", rank,
    ...(source !== undefined ? { source } : {}),
  }),
  statusChange: (
    kind_:
      | "dishonorablyDischarged" | "jailed" | "pensionForfeit"
      | "purpleHeart" | "demoted" | "ocsDenied" | "ocsWaiver"
      | "shortTerm" | "revived" | "promotionSkipped" | "commissionSkipped"
      | "voluntaryMuster" | "schoolDenied",
    note?: string,
  ): HistoryEvent => ({
    kind: "statusChange", level: "simple", kind_,
    ...(note !== undefined ? { note } : {}),
  }),
  crossTrained: (
    destination: string, kind_: "combatArm" | "branch",
  ): HistoryEvent => ({
    kind: "crossTrained", level: "simple", destination, kind_,
  }),
  transferred: (
    to: string,
    kind_: "department" | "division" | "line" | "fleet" | "branch" | "combatArm",
    from?: string,
    reason?: string,
  ): HistoryEvent => ({
    kind: "transferred", level: "simple", to, kind_,
    ...(from !== undefined ? { from } : {}),
    ...(reason !== undefined ? { reason } : {}),
  }),
};

/** Render a HistoryEvent to a display string. Used by the HistoryPanel
 *  and by sheet/PDF exporters. */
export function formatEvent(e: HistoryEvent): string {
  switch (e.kind) {
    case "raw":
      return e.text;
    case "section":
      return e.label;
    case "homeworld":
      return `Homeworld: Starport ${e.starport}, ${e.size}, ${e.atmosphere}, ` +
        `${e.hydrosphere}, ${e.population}, ${e.law}, ${e.tech}.`;
    case "attributeChange": {
      const sign = e.delta > 0 ? "+" : "";
      const reason = e.reason ? ` (${e.reason})` : "";
      const name = formatAttributeName(e.attribute);
      return `${sign}${e.delta} ${name}${reason}.`;
    }
    case "skillLearned": {
      const src = e.source ? ` (${e.source})` : "";
      return `Learned ${e.skill}-${e.skillLevel}${src}.`;
    }
    case "skillImproved": {
      const src = e.source ? ` (${e.source})` : "";
      return `Improved ${e.skill} to ${e.skillLevel}${src}.`;
    }
    case "skillReduced":
      return `Reduced ${e.skill} to level ${e.skillLevel} (${e.reason}).`;
    case "skillForfeited":
      return `Forfeited ${e.skill} (${e.reason}).`;
    case "cascadePick":
      return `${e.cascade} → ${e.chosen}.`;
    case "enlistmentAttempt": {
      const verb = e.succeeded ? "accepted" : "denied";
      const note = e.note ? ` — ${e.note}` : "";
      // Auto / gate cases have target=0 (no roll); render without dice.
      if (e.target === 0 && e.roll === 0) {
        return `Enlistment in ${e.service}: ${verb}${note}.`;
      }
      return `Enlistment in ${e.service}: ${e.roll}${dmStr(e.dm)} vs ${e.target}+ — ${verb}${note}.`;
    }
    case "drafted":
      return `Drafted into ${e.service}.`;
    case "termBegin": {
      const shortNote = e.shortTerm
        ? ` — short term${e.shortTermReason ? ` (${e.shortTermReason})` : ""}`
        : "";
      return `Term ${e.termNumber} (age ${e.age})${shortNote}.`;
    }
    case "roll": {
      const ctx = e.context ? ` (${e.context})` : "";
      const verb = e.succeeded ? "passed" : "failed";
      return `${e.rollName}${ctx}: ${e.roll}${dmStr(e.dm)} vs ${e.target}+ — ${verb}.`;
    }
    case "decoration": {
      const reason = e.reason ? ` (${e.reason})` : "";
      return `Awarded ${e.award}${reason}.`;
    }
    case "courtMartial":
      return `Court-martial: ${e.result}.`;
    case "reenlistment": {
      const tailBits: string[] = [];
      if (e.roll !== undefined && e.target !== undefined) {
        tailBits.push(`${e.roll} vs ${e.target}+`);
      }
      if (e.reason) tailBits.push(e.reason);
      const tail = tailBits.length ? ` (${tailBits.join("; ")})` : "";
      switch (e.outcome) {
        case "voluntary": return `Eligible to reenlist${tail}.`;
        case "mandatory": return `Mandatory reenlistment${tail}.`;
        case "denied": return `Denied reenlistment${tail}.`;
        case "retired": return `Mandatory retirement${tail}.`;
        case "released": return `Released from service${tail}.`;
        case "heldOver": return `Held over for next term${tail}.`;
      }
    }
    case "musterBenefit": {
      const rollTxt = `roll ${e.tableRoll}${dmStr(e.dm)}`;
      if (e.outcome === "outOfRange") {
        return `Muster benefit: ${rollTxt} → out of range (no benefit).`;
      }
      if (e.outcome === "noBenefit") {
        return `Muster benefit: ${rollTxt} → no benefit in cell.`;
      }
      return `Muster benefit: ${e.benefit} (${rollTxt}).`;
    }
    case "mortgagePayoff":
      return `Mortgage payoff: ${e.years} years on ${e.ship}.`;
    case "noEffect":
      return `No effect — ${e.reason}.`;
    case "musterCash": {
      const src = e.source ? ` — ${e.source}` : "";
      return `Muster cash: Cr${e.amount.toLocaleString()} (roll ${e.tableRoll}${dmStr(e.dm)})${src}.`;
    }
    case "browniePoint": {
      const sign = e.delta >= 0 ? "+" : "";
      return `Brownie points ${sign}${e.delta}: ${e.reason} (now ${e.balance}).`;
    }
    case "anagathics": {
      const tail = e.roll !== undefined && e.target !== undefined
        ? ` (${e.roll} vs ${e.target}+)` : "";
      switch (e.outcome) {
        case "found": return `Anagathics: supply found this term${tail}.`;
        case "lost": return `Anagathics: lost supply — withdrawal effects at end of term.`;
        case "withdrawal": return `Anagathics: withdrawal applied.`;
        case "unavailable": return `Anagathics: unavailable.`;
      }
    }
    case "agingSave": {
      const attrName = formatAttributeName(e.attribute);
      switch (e.outcome) {
        case "auto":
          return `Aging save (${attrName}): auto-saved (anagathics).`;
        case "passed": {
          const detail = e.dice && e.save !== undefined
            ? ` (${e.dice[0]}/${e.dice[1]} vs ${e.save}+)` : "";
          return `Aging save (${attrName}): passed${detail}.`;
        }
        case "failed": {
          const detail = e.dice && e.save !== undefined
            ? ` (${e.dice[0]}/${e.dice[1]} vs ${e.save}+)` : "";
          return `Aging save (${attrName}): failed${detail}.`;
        }
      }
    }
    case "preCareer": {
      const note = e.note ? ` — ${e.note}` : "";
      switch (e.result) {
        case "denied": return `${e.option}: admission denied${note}.`;
        case "washedOut": return `${e.option}: washed out${note}.`;
        case "graduated": return `${e.option}: graduated${note}.`;
        case "honors": return `${e.option}: honors graduate${note}.`;
        case "info": return `${e.option}: ${e.note ?? ""}`.trim();
      }
    }
    case "endGeneration": {
      const note = e.note ? ` — ${e.note}` : "";
      switch (e.reason) {
        case "mustered": return `======= End Generation =======${note}`;
        case "deceased": return `Character deceased — generation ended${note}.`;
        case "retired": return `Character retired — generation ended${note}.`;
      }
    }
    case "marineTradition":
      if (e.outcome === "forced") {
        return `Marine Tradition: Blade Combat → ${e.forcedSkill ?? "Large Blade"}.`;
      }
      return "Marine Tradition save passed — normal Blade Combat cascade.";
    case "assignmentRolled": {
      const where = e.term !== undefined && e.year !== undefined
        ? ` (term ${e.term} year ${e.year})` : "";
      const retained = e.retained ? " (retained)" : "";
      const note = e.note ? ` — ${e.note}` : "";
      return `Assignment: ${e.assignment}${where}${retained}${note}.`;
    }
    case "bonusSkillPoint":
      return `${e.source} overshoot +${e.overshoot}: +1 bonus skill point.`;
    case "commandDuty":
      return `Command duty roll ${e.roll}${dmStr(e.dm)} vs ${e.target}+ — ` +
        (e.inCommand ? "in command" : "staff position") + ".";
    case "schoolAssigned":
      return `School assignment: ${e.school}` +
        (e.pathway ? ` (${e.pathway})` : "") + ".";
    case "promoted": {
      const source = e.source ? ` (${e.source})` : "";
      return `Promoted to ${e.rank}${source}.`;
    }
    case "statusChange": {
      const note = e.note ? `: ${e.note}` : "";
      switch (e.kind_) {
        case "dishonorablyDischarged":
          return `Dishonorably discharged${note}.`;
        case "jailed":
          return `Jailed${note}.`;
        case "pensionForfeit":
          return `Pension forfeit${note}.`;
        case "purpleHeart":
          return `Awarded Purple Heart${note}.`;
        case "demoted":
          return `Demoted${note}.`;
        case "ocsDenied":
          return `OCS denied${note}.`;
        case "ocsWaiver":
          return `OCS waiver granted${note}.`;
        case "shortTerm":
          return `Short term${note}.`;
        case "revived":
          return `Revived${note}.`;
        case "promotionSkipped":
          return `Promotion skipped${note}.`;
        case "commissionSkipped":
          return `Commission skipped${note}.`;
        case "voluntaryMuster":
          return `Voluntarily mustered out${note}.`;
        case "schoolDenied":
          return `School denied${note}.`;
      }
    }
    case "crossTrained": {
      const label = e.kind_ === "combatArm" ? "combat arm" : "branch";
      return `Cross-trained into ${e.destination} ${label}.`;
    }
    case "transferred": {
      const fromTxt = e.from ? ` from ${e.from}` : "";
      const reasonTxt = e.reason ? ` (${e.reason})` : "";
      const label = e.kind_ === "combatArm" ? "combat arm" : e.kind_;
      return `Transferred${fromTxt} to ${e.to} ${label}${reasonTxt}.`;
    }
    default: {
      // Exhaustiveness check — if a new HistoryEvent kind is added
      // without a switch case, TypeScript fails here at compile time
      // and the runtime throws instead of silently returning undefined.
      const _: never = e;
      void _;
      throw new Error(`Unhandled history event kind: ${String((e as { kind?: unknown }).kind)}`);
    }
  }
}

function dmStr(dm: number): string {
  if (dm === 0) return "";
  return dm > 0 ? ` + ${dm}` : ` − ${Math.abs(dm)}`;
}

const ATTR_SHORT_LOOKUP: Record<string, string> = {
  strength: "Str", dexterity: "Dex", endurance: "End",
  intelligence: "Int", education: "Edu", social: "Soc",
};

function formatAttributeName(attribute: string): string {
  return ATTR_SHORT_LOOKUP[attribute]
    ?? (attribute.charAt(0).toUpperCase() + attribute.slice(1));
}

/** Filter events for a given visibility mode. */
export function visibleAt(
  events: readonly HistoryEvent[], level: HistoryLevel,
): HistoryEvent[] {
  const order: Record<HistoryLevel, number> = {
    simple: 0, verbose: 1, debug: 2,
  };
  const max = order[level];
  return events.filter((e) => order[e.level] <= max);
}
