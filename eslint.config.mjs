import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Allow underscore-prefixed unused params / vars — conventional opt-out
  // for "I had to declare it for the type signature."
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
    },
  },
  // Enforce "absolute imports only" (CLAUDE.md): ban parent-relative ('../')
  // specifiers in lib/ and app/ source; use '@/…' instead.
  {
    files: ["lib/**/*.ts", "app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^\\.\\./",
              message:
                "Use '@/…' absolute imports instead of parent-relative ('../') paths.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
