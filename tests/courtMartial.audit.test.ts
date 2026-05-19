// Court-martial audit against MT PM p. 49.
//
// Trigger: decoration roll fails by 6+.
// Guilt: enlisted auto-guilty; officers throw 10+ (DM+1 per Admin level).
// Result roll: 1D on the Court-Martial Table with DMs:
//   +1 rank E7-E9
//   +2 combat assignment
//   -2 training
//   -1 rank O7+
//   +2 in command
// Outcomes by roll value:
//   -1: case dismissed
//    0: reprimand (-1 next promo)
//    1: reprimand (-3 next promo)
//    2: rank -1
//    3: rank -2
//    4: jail 2D months, rank -2
//    5: jail 1D years, DD
//    6: jail 2D years, DD
//    7: jail 2D years, DD
//    8: death/escape, KCr10
//    9: death/escape, KCr10
//   10: death/escape killing 1D guards, KCr100

import { describe, expect, it } from "vitest";
import { getAcgCommon } from "../lib/traveller";

interface OutcomeRow { roll: number; result: string }
interface DmRow { when: Record<string, unknown>; dm: number }

describe("Court-Martial audit (PM p. 49)", () => {
  const cm = getAcgCommon("mt-megatraveller").courtMartial as
    Record<string, unknown>;

  it("Trigger: decoration roll fails by 6+", () => {
    const trigger = cm.trigger as { rule?: string };
    expect(trigger?.rule ?? "").toMatch(/6 or more|6\+/i);
  });

  it("Guilt: enlisted auto-guilty; officers 10+ on 2D with +1/Admin", () => {
    const guilt = cm.guilt as {
      enlisted?: string;
      officer?: { avoidTarget?: number; die?: string; dms?: Array<{ type?: string; skill?: string; dm?: number }> };
    };
    expect(guilt.enlisted ?? "").toMatch(/automatically guilty/i);
    expect(guilt.officer?.avoidTarget).toBe(10);
    expect(guilt.officer?.die).toBe("2D");
    const adminDm = guilt.officer?.dms?.find((d) => d.skill === "Admin");
    expect(adminDm?.dm).toBe(1);
  });

  it("Result roll DMs: E7-9 +1, combat +2, training -2, O7+ -1, command +2", () => {
    const rr = cm.resultRoll as { die?: string; dms?: DmRow[] };
    expect(rr.die).toBe("1D");
    const dms = rr.dms ?? [];
    const e7Plus = dms.find((d) =>
      (d.when as Record<string, { letter?: string; min?: number; max?: number }>)?.rankBetween?.letter === "E"
      && (d.when as Record<string, { letter?: string; min?: number; max?: number }>)?.rankBetween?.min === 7);
    expect(e7Plus?.dm).toBe(1);
    const combat = dms.find((d) =>
      (d.when as Record<string, string>)?.currentAssignmentIs === "combat");
    expect(combat?.dm).toBe(2);
    const training = dms.find((d) =>
      (d.when as Record<string, string>)?.currentAssignmentIs === "training");
    expect(training?.dm).toBe(-2);
    const o7Plus = dms.find((d) =>
      (d.when as Record<string, { letter?: string; min?: number }>)?.rankAtLeast?.letter === "O"
      && (d.when as Record<string, { letter?: string; min?: number }>)?.rankAtLeast?.min === 7);
    expect(o7Plus?.dm).toBe(-1);
    const command = dms.find((d) =>
      (d.when as Record<string, boolean>)?.currentlyInCommand === true);
    expect(command?.dm).toBe(2);
  });

  it("Outcomes match PM table cell-for-cell", () => {
    const rows = cm.dieResults as OutcomeRow[];
    const byRoll = new Map(rows.map((r) => [r.roll, r.result]));
    expect(byRoll.get(-1)).toMatch(/dismissed/i);
    expect(byRoll.get(0)).toMatch(/reprimand.*-1/i);
    expect(byRoll.get(1)).toMatch(/reprimand.*-3/i);
    expect(byRoll.get(2)).toMatch(/rank.*-1/i);
    expect(byRoll.get(3)).toMatch(/rank.*-2/i);
    expect(byRoll.get(4)).toMatch(/jail.*2D months/i);
    expect(byRoll.get(5)).toMatch(/jail.*1D year.*DD|dishonorable/i);
    expect(byRoll.get(6)).toMatch(/jail.*2D year.*DD|dishonorable/i);
    expect(byRoll.get(7)).toMatch(/jail.*2D year.*DD|dishonorable/i);
    expect(byRoll.get(8)).toMatch(/death.*escape.*KCr10\b/i);
    expect(byRoll.get(9)).toMatch(/death.*escape.*KCr10\b/i);
    expect(byRoll.get(10)).toMatch(/death.*kill.*1D.*KCr100/i);
  });
});
