import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/deployment/**/*.test.ts"],
    passWithNoTests: false,
  },
});
