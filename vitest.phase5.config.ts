import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "test/phase5/**/*.integration.test.ts",
      "packages/migration/src/**/*.integration.test.ts",
    ],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
