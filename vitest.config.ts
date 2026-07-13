import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    // Pin the worker pool explicitly. Left unset, Vitest 4 re-resolves the
    // default pool separately in the main process and inside each worker, and
    // the two can disagree — the worker then boots a runtime that mismatches the
    // main context and setup files fail intermittently with "Vitest failed to
    // find the current suite" (seen as full-suite 84/84 flakes). Pinning it
    // makes both contexts agree; "forks" is Vitest 4's stated default.
    pool: "forks",
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**", "components/**"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
