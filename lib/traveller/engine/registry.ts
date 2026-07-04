// Named-extension registries. The engine has several "name -> implementation"
// maps referenced by identifiers in the edition JSON — the basic-chargen step
// registry, the ACG pathway factories, the pathway callbacks, the promotion
// and preRun hooks. They differ in scope (global vs per-edition) and location,
// but every one shares the same lookup shape: resolve a JSON-declared name
// against the map and fail loudly with an actionable message when the name is
// not registered. This is that one lookup primitive.

/** Look up `key` in a named-extension registry, returning the entry or
 *  throwing `buildError()` when it is absent. Callers own the message so each
 *  registry keeps its edition/pathway-specific "register it here" guidance. */
export function requireHook<T>(
  registry: Readonly<Record<string, T>> | undefined,
  key: string,
  buildError: () => string,
): T {
  const entry = registry?.[key];
  if (entry === undefined) throw new Error(buildError());
  return entry;
}
