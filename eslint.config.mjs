import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([".next/**", "out/**", "build/**", "dist/**", "drizzle/**", "next-env.d.ts"]),

  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      // Server logs go through console.info/warn/error deliberately; a stray
      // console.log is debugging left behind.
      "no-console": ["error", { allow: ["info", "warn", "error"] }],
    },
  },

  {
    // Design-system discipline: a literal hex colour in feature code means the
    // token layer was bypassed. Tokens and the showcase are where literal
    // values legitimately live.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/styles/**", "src/components/showcase/**", "src/app/design-system/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/#[0-9a-fA-F]{3,8}\\b/]",
          message: "Hard-coded colour. Use a design token from src/styles/tokens.css.",
        },
        {
          selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b/]",
          message: "Hard-coded colour. Use a design token from src/styles/tokens.css.",
        },
      ],
    },
  },

  {
    // The browser must never reach the database or server secrets. Client
    // components are the ones that cannot import these; server-only modules
    // enforce it at build time too.
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/db/*", "@/server/*"],
              message:
                "Components render in the browser too. Fetch data in a server component or action and pass it down.",
            },
          ],
        },
      ],
    },
  },
]);
