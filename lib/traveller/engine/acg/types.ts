// ACG resolution types. Per-pathway character state (AcgState +
// variants + freshAcgState) lives in ./state. Importers can pull from
// either module; this file re-exports state.ts so older import paths
// like `import { AcgState } from "engine/acg/types"` keep working.

export type {
  AcgPathwayId,
  AcgState,
  MercenaryAcgFields,
  NavyAcgFields,
  ScoutAcgFields,
  MerchantAcgFields,
  MercenaryAcgState,
  NavyAcgState,
  ScoutAcgState,
  MerchantAcgState,
  SubStepOutcome,
  ThisYearOutcomes,
} from "./state";
export {
  isMercenaryAcg,
  isNavyAcg,
  isScoutAcg,
  isMerchantAcg,
  recordTransfer,
  freshAcgState,
} from "./state";

/** Resolution targets for one assignment row. Targets are either a
 *  numeric throw, "auto" (always succeeds), or "none" (no roll). */
export type ResolutionTarget = number | "auto" | "none";

export interface AssignmentResolution {
  survival: ResolutionTarget;
  decoration: ResolutionTarget;
  promotion: ResolutionTarget;
  skills: ResolutionTarget;
  /** "8+" style — when listed in parentheses on the table, officers may
   *  not roll for promotion under this assignment. */
  promotionOfficersBarred?: boolean;
}

/** A single row of an `assignment` table — keyed by die result. */
export interface AssignmentRow {
  die: number;
  [columnKey: string]: number | string;
}

export interface AssignmentTable {
  columns: string[];
  rows: AssignmentRow[];
  dms?: string[];
  notes?: string[];
}

export interface DecorationOutcome {
  /** Award earned, or null on no award. */
  award: "MCUF" | "MCG" | "SEH" | null;
  /** True when the decoration roll failed by 6+ (court martial). */
  courtMartial: boolean;
}
