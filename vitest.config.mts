import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // import.meta.dirname rather than __dirname: this file is ESM (.mts) and
    // Vite's native config loader does not provide CJS globals.
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    // Most suites are pure logic and run in Node; the few component tests
    // opt into jsdom with a per-file `// @vitest-environment jsdom` pragma.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});
