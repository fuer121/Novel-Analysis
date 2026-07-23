import { defineConfig } from "vitest/config";

const scale = process.env.PHASE5_SCALE === "1";

export default defineConfig({
  test: {
    environment: "node",
    include: scale
      ? ["test/phase5/scale.integration.test.ts"]
      : [
          "test/phase5/**/*.e2e.test.ts",
          "test/phase5/**/*.integration.test.ts",
        ],
    exclude: scale ? [] : ["test/phase5/scale.integration.test.ts"],
    testTimeout: scale ? 180_000 : 60_000,
    hookTimeout: scale ? 180_000 : 60_000,
    fileParallelism: false,
  },
});
