import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: fileURLToPath(new URL("./src/cli.ts", import.meta.url)),
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
    target: "node22",
    rollupOptions: {
      treeshake: {
        moduleSideEffects: (id) =>
          !id.endsWith("/packages/database/src/migrate.ts"),
      },
      output: {
        entryFileNames: "cli.js",
      },
    },
  },
  ssr: {
    noExternal: ["@novel-analysis/database"],
  },
});
