import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "packages/**/*.integration.test.ts",
      "apps/**/*.integration.test.ts",
      "test/phase2/**/*.integration.test.ts",
    ],
    exclude: ["**/*.unit.test.ts", "**/*.e2e.test.ts", "test/phase1/**"],
    passWithNoTests: true,
  },
});
