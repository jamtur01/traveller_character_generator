// H3 regression — ACG enlist form rendered blank for every ACG character.
//
// Bug: `applyPreCareer('skip')` cleared the page-level `acgPathway` React
// state, and AcgEnlistPhase switched its pathway-specific fields on that
// (now-empty) page prop — so the whole form rendered blank. The fix makes
// the component derive the pathway from `character.acgPathway` (the source
// of truth set at startCareer), which survives the pre-career skip.
//
// H3 path chosen: RENDER TEST via react-dom/server `renderToStaticMarkup`.
// This renders the *real* component with the *real* props and asserts on
// its output — a faithful reproduction of the bug — without adding jsdom
// or @testing-library (react-dom/server is already a dependency). The only
// infra added is the `@/` path alias in vitest.config.ts, which the
// component's imports require.
//
// Teeth: each render passes a character carrying the pathway but NO separate
// pathway prop. The fixed component reads `character.acgPathway` and renders
// that pathway's fields; the pre-fix component (switching on a cleared page
// prop) rendered none. Cross-checking the two pathways proves the branch is
// driven by `character.acgPathway`: mercenary shows "Combat arm" and hides
// "Fleet"; navy shows "Fleet" and hides "Combat arm". If the component
// ignored `character.acgPathway` (the bug), every pathway-specific field
// would be absent and both "present" assertions would fail.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AcgEnlistPhase,
  initialAcgFormState,
} from "@/app/components/phases/AcgEnlistPhase";
import { Character } from "@/lib/traveller/character";

function renderPhase(acgPathway: string): string {
  const c = new Character();
  c.editionId = "mt-megatraveller";
  c.acgPathway = acgPathway;
  return renderToStaticMarkup(
    <AcgEnlistPhase
      character={c}
      edition="mt-megatraveller"
      form={initialAcgFormState}
      setForm={() => {}}
      onEnlist={() => {}}
    />,
  );
}

describe("H3: AcgEnlistPhase derives pathway fields from character.acgPathway", () => {
  it("mercenary character renders the mercenary-only 'Combat arm' field, not navy 'Fleet'", () => {
    const html = renderPhase("mercenary");
    expect(html).toContain("Configure Mercenary enlistment");
    expect(html).toContain("Combat arm");
    expect(html).not.toContain("Fleet");
  });

  it("navy character renders the navy-only 'Fleet' field, not mercenary 'Combat arm'", () => {
    const html = renderPhase("navy");
    expect(html).toContain("Configure Navy enlistment");
    expect(html).toContain("Fleet");
    expect(html).not.toContain("Combat arm");
  });
});
