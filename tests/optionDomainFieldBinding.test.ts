// Teeth for the option-domain `field` binding (the Phase-2 obligation named in
// lib/traveller/editions/optionDomains.ts: "Its type-level binding to
// keyof EnlistOptions is enforced by a chargen-layer test added in Phase 2").
//
// Contract under test: every ENLIST-FORM option domain reports a `field` that is
// a real, writable key of EnlistOptions. The exhaustive driver writes each pick
// into the enlist form BY that field name (session.enlist(snap, opts)); a domain
// that declared a field which is NOT an EnlistOptions key would silently drop the
// pick and generate the wrong character. This test lives in the chargen-importing
// layer where EnlistOptions is in scope — the real teeth the editions-layer
// audit-locks (which can't see the chargen types) cannot provide.
//
// Compile-time half: SAMPLE_ENLIST `satisfies EnlistOptions` fixes ENLIST_KEYS to
// exactly the EnlistOptions key set — a rename/removal of an EnlistOptions field
// breaks tsc here first, and an excess key is rejected too. Runtime half: every
// enlist-form domain each active edition offers must report a `field` that is a
// member of that key set. Together they fail if a field string is not a real
// EnlistOptions key (compile time when the interface drifts, runtime when a
// domain's field drifts), and — because the loop reads the ACTUAL domains — a
// newly-registered enlist-form domain with a bad field reddens too.
//
// Exemptions: acg.pathway carries a field ("acgPathway") that is a
// StartCareerOptions field (the pathway is chosen at startCareer, before the
// enlist form), NOT an EnlistOptions key — so it is a start-form domain, not an
// enlist-form one, and is out of scope. mongoose.career is an in-flow
// pickOrDefer domain with no field at all. Both are correctly excluded below.

import { describe, expect, it } from "vitest";
import { listEditions } from "@/lib/traveller/editions";
import { optionDomain } from "@/lib/traveller/editions/optionDomains";
import type { EnlistOptions } from "@/lib/traveller/chargen/session";

// A real EnlistOptions value. `satisfies` proves the literal is EXACTLY the
// EnlistOptions shape (a missing key fails assignability; an excess key fails
// the satisfies excess check), so Object.keys yields precisely the writable
// EnlistOptions keys and this set tracks the interface at compile time.
const SAMPLE_ENLIST = {
  verbose: false,
  preferredService: "random",
  acgService: "army",
  acgCombatArm: "",
  acgFleet: "imperialNavy",
  acgDivision: "field",
  acgLineType: "",
  acgSubsectorTech: "",
  acgMerchantAcademy: false,
} satisfies EnlistOptions;

const ENLIST_KEYS = new Set<string>(Object.keys(SAMPLE_ENLIST));

// The enlist-form decision ids, grouped by the chargen model that presents the
// enlist form. These are the optionDomain keys whose `field` targets an
// EnlistOptions property (acg.pathway → StartCareerOptions and mongoose.career →
// no field are deliberately absent). optionDomain resolves values from cited
// JSON, so each id is only queried for editions whose model + declared pathways
// actually offer it (guarded below).
const ENLIST_FORM_DECISIONS: Readonly<Record<string, readonly string[]>> = {
  classic: ["classic.service"],
  acg: [
    "acg.mercenary.service",
    "acg.navy.fleet",
    "acg.navy.subsectorTech",
    "acg.scout.division",
    "acg.merchant.lineType",
  ],
};

interface Binding {
  readonly edition: string;
  readonly decision: string;
  readonly field: string | undefined;
}

// Resolve the (edition, decision, field) of every enlist-form domain each active
// edition actually offers. An ACG edition that doesn't declare a given PM pathway
// simply doesn't present that sub-domain (mirrors the coverage matrix's skip), so
// we guard on pathway availability before reading — reading an absent pathway
// would fail loud in optionDomain.
const bindings: Binding[] = [];
for (const meta of listEditions()) {
  if (meta.status !== "active") continue;
  for (const model of meta.chargenModels) {
    const decisions = ENLIST_FORM_DECISIONS[model] ?? [];
    if (decisions.length === 0) continue;
    const pathways = model === "acg" ? optionDomain(meta.id, "acg.pathway").values : [];
    for (const decision of decisions) {
      if (model === "acg") {
        const segment = decision.split(".")[1]!;
        if (!pathways.some((p) => p.startsWith(segment))) continue;
      }
      bindings.push({
        edition: meta.id,
        decision,
        field: optionDomain(meta.id, decision).field,
      });
    }
  }
}

describe("option-domain field binding — enlist-form fields are real EnlistOptions keys", () => {
  it("resolves at least one enlist-form domain to check", () => {
    // Guards the loop above from silently passing by observing nothing (e.g. if
    // every domain were mis-scoped out or every edition went data-only).
    expect(bindings.length).toBeGreaterThan(0);
  });

  it.each(bindings.map((b) => ({ ...b, name: `${b.edition} · ${b.decision}` })))(
    "$name declares a keyof EnlistOptions field",
    ({ decision, field }) => {
      expect(field, `${decision} must declare an enlist field`).toBeDefined();
      expect(
        ENLIST_KEYS.has(field!),
        `${decision}.field "${field}" is not a key of EnlistOptions`,
      ).toBe(true);
    },
  );
});
