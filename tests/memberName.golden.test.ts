// derivedMemberName GOLDEN LOCK for every service in every service-model
// edition (CT + MT). Phase 9 of the pathway-as-JSON rewrite moves the
// 18-branch printed-content string table in lib/traveller/engine/serviceLoader.ts
// (derivedMemberName, ~L325-344) out of the TS switch and into per-service
// cited JSON. This file pins the CURRENT observable member noun for EVERY
// service key so that move is provably behavior-preserving: it must stay GREEN
// across the rewrite, and a changed, dropped, or renamed noun reddens exactly
// one row — which is the point.
//
// Seam. derivedMemberName is a module-private function; it is NOT exported and
// no production change is made here. It is surfaced through its single
// consumer path: buildServiceDef stamps memberName = derivedMemberName(
// serviceData.displayName) onto every ServiceDef, and getEditionServices(id)
// returns the built map. So getEditionServices(id)[key].memberName IS the exact
// output of derivedMemberName for that service — the same value sheet.ts
// (header prefix "Marine Captain Bob") and CharacterSummary.tsx (React
// subtitle) read. Nothing else consumes it: it does not feed history events or
// rank labels.
//
// The DEFAULT / fallthrough branch (`return displayName`, L343) is the residue-
// flagged silent-fallthrough risk, and it is covered explicitly by real
// services that hit it:
//   - CT: navy ("Navy") and army ("Army") have NO switch case -> fallthrough.
//   - MT: only marines ("Marines") hits a switch branch; every other MT service
//     stores an ALREADY-SINGULAR displayName ("Scout", "Belter", ...) that no
//     plural switch case matches, plus lawenforcers ("Law Enforcer") which is
//     absent from the switch entirely -> all 17 resolve through the fallthrough.
// The "Other" -> "" special case (L326) is covered by CT's `other`; sheet.ts
// additionally short-circuits `service === "other"`, so that empty noun is
// belt-and-suspenders, but the derived value is locked here regardless.
//
// CT's 18 memberName values are ALSO captured inside the large auto-updatable
// snapshot in tests/services.snapshot.test.ts (per-service `memberName` field);
// this file adds MT's full matrix (uncovered anywhere) and re-locks CT as an
// explicit, hand-maintained table a reviewer must consciously edit, rather than
// a snapshot that `vitest -u` can silently regenerate mid-refactor.

import { describe, expect, it } from "vitest";
import { getEditionServices, type ServiceDef, type ServiceKey } from "../lib/traveller";

// CT (ct-classic.json): 15 plural switch branches -> singular, "Other" -> "",
// and navy/army through the generic fallthrough.
const CT_MEMBER_NOUNS: Record<string, string> = {
  navy: "Navy", // fallthrough (no "Navy" case)
  marines: "Marine",
  army: "Army", // fallthrough (no "Army" case)
  scouts: "Scout",
  merchants: "Merchant",
  other: "", // "Other" special case -> ""
  pirates: "Pirate",
  belters: "Belter",
  sailors: "Sailor",
  diplomats: "Diplomat",
  doctors: "Doctor",
  flyers: "Flyer",
  barbarians: "Barbarian",
  bureaucrats: "Bureaucrat",
  rogues: "Rogue",
  scientists: "Scientist",
  hunters: "Hunter",
  nobles: "Noble",
};

// MT (mt-megatraveller.json): displayNames are already singular (except the
// still-plural "Navy"/"Marines"/"Army"), so only `marines` hits the switch;
// every other key resolves through the `return displayName` fallthrough,
// including MT-only `lawenforcers` ("Law Enforcer", absent from the switch).
const MT_MEMBER_NOUNS: Record<string, string> = {
  navy: "Navy", // fallthrough
  marines: "Marine", // "Marines" switch case
  army: "Army", // fallthrough
  scouts: "Scout", // fallthrough (displayName "Scout", not "Scouts")
  merchants: "Merchant", // fallthrough (displayName "Merchant")
  pirates: "Pirate", // fallthrough (displayName "Pirate")
  belters: "Belter", // fallthrough (displayName "Belter")
  sailors: "Sailor", // fallthrough (displayName "Sailor")
  diplomats: "Diplomat", // fallthrough (displayName "Diplomat")
  doctors: "Doctor", // fallthrough (displayName "Doctor")
  flyers: "Flyer", // fallthrough (displayName "Flyer")
  barbarians: "Barbarian", // fallthrough (displayName "Barbarian")
  bureaucrats: "Bureaucrat", // fallthrough (displayName "Bureaucrat")
  rogues: "Rogue", // fallthrough (displayName "Rogue")
  scientists: "Scientist", // fallthrough (displayName "Scientist")
  hunters: "Hunter", // fallthrough (displayName "Hunter")
  lawenforcers: "Law Enforcer", // fallthrough (MT-only, absent from switch)
  nobles: "Noble", // fallthrough (displayName "Noble")
};

const EDITIONS: ReadonlyArray<{ id: string; nouns: Record<string, string> }> = [
  { id: "ct-classic", nouns: CT_MEMBER_NOUNS },
  { id: "mt-megatraveller", nouns: MT_MEMBER_NOUNS },
];

for (const { id, nouns } of EDITIONS) {
  describe(`derivedMemberName golden lock — ${id}`, () => {
    const map = getEditionServices(id) as Record<ServiceKey, ServiceDef>;

    it("the built service-key set exactly matches the locked noun table", () => {
      // Catches a service added/removed by the JSON move without its noun being
      // locked — the it.each below only iterates the expected table, so this is
      // the sole guard on the "new key appeared" direction.
      expect(Object.keys(map).sort()).toEqual(Object.keys(nouns).sort());
    });

    it.each(Object.entries(nouns))("%s member noun = %j", (key, noun) => {
      expect(map[key as ServiceKey].memberName).toBe(noun);
    });
  });
}
