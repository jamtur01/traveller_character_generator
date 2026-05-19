// Shared pathway plumbing. Each ACG pathway needs the same four
// helpers around its PathwaySpec: lazy-built per-edition cache,
// cache-purge for tests / hot-reload, eager validation at edition load,
// and the cache lookup. The shapes are identical — only the pathway
// key, callback registry, and combatAssignments accessor differ. This
// module factors the boilerplate into createPathwaySpecRegistry; each
// pathway then wires its specifics in ~5 lines instead of ~30.

import type { Character } from "../../../character";
import { getEdition } from "../../../editions";
import type { PathwaySpec } from "../phaseRunner";
import {
  buildPathwaySpecFromConfig, type PathwayCallbacks,
  type ResolveAssignmentConfig,
} from "../jsonPhases";

interface PathwayRegistryOptions<TData> {
  /** Key under `advancedCharacterGeneration` in edition JSON
   *  ("mercenary", "navy", "scout", "merchantPrince"). */
  pathwayKey: string;
  callbacks: PathwayCallbacks;
  /** Read combat-assignment names from the pathway's data block. Empty
   *  array for pathways that don't have a Purple Heart phase. */
  combatAssignments: (data: TData) => readonly string[];
}

export interface PathwayRegistry {
  /** Get the cached PathwaySpec for this character's edition, building
   *  on first access. Throws if the edition declares the pathway but
   *  omits the resolveAssignment config. */
  get(ch: Character): PathwaySpec;
  /** Drop every cached spec. Required when edition JSON is reloaded so
   *  the next resolveAssignment rebuilds against the updated config and
   *  callback registry. */
  clear(): void;
  /** Build and discard the spec for an edition to surface missing
   *  callback names / malformed phase configs at edition load instead
   *  of at first ACG run. No-op if the edition doesn't declare this
   *  pathway or omits resolveAssignment. */
  validate(editionId: string): void;
}

export function createPathwaySpecRegistry<TData>(
  opts: PathwayRegistryOptions<TData>,
): PathwayRegistry {
  const cache = new Map<string, PathwaySpec>();

  function dataForEdition(editionId: string):
    (TData & { resolveAssignment?: ResolveAssignmentConfig }) | undefined {
    const acg = getEdition(editionId).data.advancedCharacterGeneration as
      Record<string, unknown> | undefined;
    return acg?.[opts.pathwayKey] as
      (TData & { resolveAssignment?: ResolveAssignmentConfig }) | undefined;
  }

  return {
    get(ch) {
      let spec = cache.get(ch.editionId);
      if (spec) return spec;
      const data = dataForEdition(ch.editionId);
      if (!data?.resolveAssignment) {
        throw new Error(
          `Edition "${ch.editionId}" ${opts.pathwayKey} block is missing ` +
          `resolveAssignment config — add it to ` +
          `data/editions/${ch.editionId}.json`,
        );
      }
      spec = buildPathwaySpecFromConfig(data.resolveAssignment, opts.callbacks, {
        combatAssignments: (c) => {
          const d = dataForEdition(c.editionId);
          return d ? opts.combatAssignments(d) : [];
        },
      });
      cache.set(ch.editionId, spec);
      return spec;
    },
    clear() { cache.clear(); },
    validate(editionId) {
      const data = dataForEdition(editionId);
      if (!data?.resolveAssignment) return;
      buildPathwaySpecFromConfig(data.resolveAssignment, opts.callbacks, {
        combatAssignments: () => opts.combatAssignments(data),
      });
    },
  };
}

/** Per-term reset for pathways that participate in combat assignments
 *  (mercenary, navy). injuredThisYear is a per-year flag cleared as a
 *  safety net; decorationDmStrategy is the player's per-assignment
 *  survival↔decoration tradeoff choice and must not leak across terms. */
export function resetCombatTermFlags(ch: Character): void {
  if (!ch.acgState) return;
  ch.acgState.injuredThisYear = false;
  ch.acgState.decorationDmStrategy = 0;
}
