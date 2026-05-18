// Direct coverage for #5: events[] is the source of truth, history
// derives on read. The whole point of the refactor was that changing
// `showHistory` AFTER chargen retroactively shows/hides events without
// re-running. No existing test demonstrates this.

import { describe, expect, it } from "vitest";
import { Character } from "../lib/traveller/character";
import { event as ev } from "../lib/traveller/history";

function logSampleEvents(c: Character): void {
  c.log(ev.section("---", "verbose"));
  c.log(ev.skillLearned("Pilot", 1, "test"));   // simple
  c.log(ev.roll("Survival", 7, 0, 5, true));     // verbose
  c.log(ev.raw("debug-only diagnostic", "debug")); // debug
}

describe("renderHistory filters by level (#5)", () => {
  it("simple mode hides verbose and debug events", () => {
    const c = new Character();
    c.showHistory = "simple";
    logSampleEvents(c);
    const out = c.history;
    expect(out.some((s) => s.includes("Learned Pilot"))).toBe(true); // simple
    expect(out.some((s) => s.includes("Survival"))).toBe(false);     // verbose hidden
    expect(out.some((s) => s.includes("debug-only"))).toBe(false);   // debug hidden
  });

  it("verbose mode shows simple + verbose, hides debug", () => {
    const c = new Character();
    c.showHistory = "verbose";
    logSampleEvents(c);
    const out = c.history;
    expect(out.some((s) => s.includes("Learned Pilot"))).toBe(true);
    expect(out.some((s) => s.includes("Survival"))).toBe(true);
    expect(out.some((s) => s.includes("debug-only"))).toBe(false);
  });

  it("debug mode shows everything", () => {
    const c = new Character();
    c.showHistory = "debug";
    logSampleEvents(c);
    const out = c.history;
    expect(out.some((s) => s.includes("Learned Pilot"))).toBe(true);
    expect(out.some((s) => s.includes("Survival"))).toBe(true);
    expect(out.some((s) => s.includes("debug-only"))).toBe(true);
  });
});

describe("history derives on read — runtime level toggle (#5)", () => {
  it("changing showHistory after logging events retroactively re-filters", () => {
    const c = new Character();
    c.showHistory = "simple";
    logSampleEvents(c);
    const simpleLen = c.history.length;

    // Bump to verbose without re-logging — the getter should now include
    // the verbose Survival event.
    c.showHistory = "verbose";
    const verboseLen = c.history.length;
    expect(verboseLen).toBeGreaterThan(simpleLen);
    expect(c.history.some((s) => s.includes("Survival"))).toBe(true);

    // Drop back to simple — verbose events disappear from the rendered view.
    c.showHistory = "simple";
    expect(c.history.length).toBe(simpleLen);
    expect(c.history.some((s) => s.includes("Survival"))).toBe(false);
  });

  it("renderHistory(level) explicit param overrides showHistory", () => {
    const c = new Character();
    c.showHistory = "simple";
    logSampleEvents(c);
    // showHistory is simple but we ask for verbose rendering.
    const verbose = c.renderHistory("verbose");
    expect(verbose.some((s) => s.includes("Survival"))).toBe(true);
    // Original showHistory unchanged.
    expect(c.history.some((s) => s.includes("Survival"))).toBe(false);
  });
});

describe("events[] is canonical (#5)", () => {
  it("log() pushes to events[] only — no dual-write into a stored history array", () => {
    const c = new Character();
    c.showHistory = "simple";
    const beforeEvents = c.events.length;
    c.log(ev.skillLearned("Pilot", 1));
    expect(c.events.length).toBe(beforeEvents + 1);
    // history is a derived getter; it returns a fresh array each call.
    expect(c.history).not.toBe(c.history); // distinct array references
  });
});
