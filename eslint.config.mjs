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
    // Prisma's generated client. Not our code, regenerated on every build,
    // and it legitimately uses `any` internally — linting it produces ~700
    // unfixable findings that bury real problems in our own source.
    "src/generated/**",
  ]),
]);

export default eslintConfig;
