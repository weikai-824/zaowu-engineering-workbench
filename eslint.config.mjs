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
    ".vinext/**",
    ".wrangler/**",
    ".sites-runtime/**",
    ".workbuddy/**",
    "**/.venv/**",
    "**/.pytest_cache/**",
    "**/.mypy_cache/**",
    "**/.ruff_cache/**",
    "out/**",
    "build/**",
    "dist/**",
    "work/**",
    "output/**",
    "migration-package/**",
    "generated-images/**",
    ".langgraph_api/**",
    "services/agent/.langgraph_api/**",
    "showcase/**",
    "validation/**",
    "vendor/**",
    "examples/**",
    "public/**",
    "next-env.d.ts",
  ]),
  {
    files: ["components/ui/**/*.{ts,tsx}", "hooks/use-mobile.ts"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["app/process-settings.tsx", "app/tripo-jobs.tsx", "app/workbench.tsx"],
    rules: {
      // These views render private object URLs and fixed local machine photos;
      // routing them through the framework image optimizer would break that flow.
      "@next/next/no-img-element": "off",
    },
  },
]);

export default eslintConfig;
