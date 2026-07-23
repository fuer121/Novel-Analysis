import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/migration/src/**/*.test.ts"],
    passWithNoTests: false,
  },
});
