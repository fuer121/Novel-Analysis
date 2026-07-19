import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "apps/**/*.test.tsx"],
    exclude: [
      "**/*.integration.test.ts",
      "**/*.e2e.test.ts",
      "test/phase1/**",
    ],
    passWithNoTests: false,
  },
});
