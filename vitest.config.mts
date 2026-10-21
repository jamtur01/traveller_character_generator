import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Repo root (this file's directory), invocation-independent.
const root = fileURLToPath(new URL(".", import.meta.url));

// Minimal, additive config: teach Vitest the `@/` path alias that the
// app/ components use (tsconfig `paths`). Vitest 4's oxc transformer
// already honors the tsconfig `jsx: react-jsx` setting, so `.tsx` tests
// transform without an explicit React import. Nothing here changes test
// discovery or the default `node` environment, so the existing suite is
// unaffected.
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: root }],
  },
});
