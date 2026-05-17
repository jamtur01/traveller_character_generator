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
// Backward compatibility: a "raw" event kind wraps an arbitrary string
// so legacy `character.logRaw("X")` sites that haven't been
// migrated yet still produce a consumable event. Over time, those sites
// migrate to typed event constructors and the raw fallback drops out.
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
  // Character generation start: attributes rolled.
  | {
      kind: "attributesRolled";
      level: HistoryLevel;
      strength: number; dexterity: number; endurance: number;
      intelligence: number; education: number; social: number;
    }
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
  // Enlistment attempt.
  | {
      kind: "enlistmentAttempt";
      level: HistoryLevel;
      service: string; roll: number; dm: number; target: number;
      succeeded: boolean;
    }
  // Drafted into a service (after failed enlistment).
  | { kind: "drafted"; level: HistoryLevel; service: string }
  // Term begins.
  | { kind: "termBegin"; level: HistoryLevel; termNumber: number; age: number }
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
      roll?: number; target?: number;
    }
  // Mustering-out benefit roll.
  | {
      kind: "musterBenefit";
      level: HistoryLevel;
      benefit: string; tableRoll: number; dm: number;
    }
  // Mustering-out cash roll.
  | {
      kind: "musterCash";
      level: HistoryLevel;
      amount: number; tableRoll: number; dm: number;
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
  // Pre-career attempt.
  | {
      kind: "preCareer";
      level: HistoryLevel;
      option: string;
      result: "denied" | "washedOut" | "graduated" | "honors";
      note?: string;
    }
  // Character ended generation (died, mustered, retired).
  | {
      kind: "endGeneration";
      level: HistoryLevel;
      reason: "mustered" | "deceased" | "retired";
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
    kind: "skillLearned", level: "verbose", skill, skillLevel,
    ...(source !== undefined ? { source } : {}),
  }),
  skillImproved: (skill: string, skillLevel: number, source?: string): HistoryEvent => ({
    kind: "skillImproved", level: "verbose", skill, skillLevel,
    ...(source !== undefined ? { source } : {}),
  }),
  attributeChange: (attribute: string, delta: number, reason?: string): HistoryEvent => ({
    kind: "attributeChange", level: "verbose", attribute, delta,
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
    case "attributesRolled":
      return `Attributes rolled: Str ${e.strength}, Dex ${e.dexterity}, ` +
        `End ${e.endurance}, Int ${e.intelligence}, Edu ${e.education}, ` +
        `Soc ${e.social}.`;
    case "homeworld":
      return `Homeworld: Starport ${e.starport}, ${e.size}, ${e.atmosphere}, ` +
        `${e.hydrosphere}, ${e.population}, ${e.law}, ${e.tech}.`;
    case "attributeChange": {
      const sign = e.delta > 0 ? "+" : "";
      const reason = e.reason ? ` (${e.reason})` : "";
      return `${sign}${e.delta} ${e.attribute}${reason}`;
    }
    case "skillLearned": {
      const src = e.source ? ` (${e.source})` : "";
      return `Learned ${e.skill}-${e.skillLevel}${src}`;
    }
    case "skillImproved": {
      const src = e.source ? ` (${e.source})` : "";
      return `Improved ${e.skill} to ${e.skillLevel}${src}`;
    }
    case "skillReduced":
      return `Reduced ${e.skill} to level ${e.skillLevel} (${e.reason})`;
    case "skillForfeited":
      return `Forfeited ${e.skill} (${e.reason})`;
    case "cascadePick":
      return `${e.cascade} → ${e.chosen}`;
    case "enlistmentAttempt": {
      const verb = e.succeeded ? "accepted" : "denied";
      return `Enlistment in ${e.service}: ${e.roll}${dmStr(e.dm)} vs ${e.target}+ — ${verb}`;
    }
    case "drafted":
      return `Drafted into ${e.service}.`;
    case "termBegin":
      return `Term ${e.termNumber} (age ${e.age})`;
    case "roll": {
      const ctx = e.context ? ` (${e.context})` : "";
      const verb = e.succeeded ? "passed" : "failed";
      return `${e.rollName}${ctx}: ${e.roll}${dmStr(e.dm)} vs ${e.target}+ — ${verb}`;
    }
    case "decoration": {
      const reason = e.reason ? ` (${e.reason})` : "";
      return `Awarded ${e.award}${reason}.`;
    }
    case "courtMartial":
      return `Court-martial: ${e.result}.`;
    case "reenlistment": {
      const tail = e.roll !== undefined && e.target !== undefined
        ? ` (${e.roll} vs ${e.target}+)` : "";
      switch (e.outcome) {
        case "voluntary": return `Eligible to reenlist${tail}.`;
        case "mandatory": return `Mandatory reenlistment${tail}.`;
        case "denied": return `Denied reenlistment${tail}.`;
        case "retired": return `Mandatory retirement${tail}.`;
        case "released": return `Released from service${tail}.`;
        case "heldOver": return `Held over for next term${tail}.`;
      }
    }
    case "musterBenefit":
      return `Muster benefit: ${e.benefit} (roll ${e.tableRoll}${dmStr(e.dm)}).`;
    case "musterCash":
      return `Muster cash: Cr${e.amount.toLocaleString()} (roll ${e.tableRoll}${dmStr(e.dm)}).`;
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
    case "preCareer": {
      const note = e.note ? ` — ${e.note}` : "";
      switch (e.result) {
        case "denied": return `${e.option}: admission denied${note}.`;
        case "washedOut": return `${e.option}: washed out${note}.`;
        case "graduated": return `${e.option}: graduated${note}.`;
        case "honors": return `${e.option}: honors graduate${note}.`;
      }
    }
    case "endGeneration":
      switch (e.reason) {
        case "mustered": return "======= End Generation =======";
        case "deceased": return "Character deceased — generation ended.";
        case "retired": return "Character retired — generation ended.";
      }
  }
}

function dmStr(dm: number): string {
  if (dm === 0) return "";
  return dm > 0 ? ` + ${dm}` : ` − ${Math.abs(dm)}`;
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
