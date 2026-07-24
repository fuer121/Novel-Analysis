import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

export default defineConfig({
  publicDir: false,
  plugins: [{
    name: "phase5-disable-unused-express-view-loader",
    transform(code, id) {
      if (!id.endsWith("/express/lib/view.js")) return;
      const dynamicViewLoader = "var fn = require(mod).__express";
      if (!code.includes(dynamicViewLoader)) {
        throw new Error("express_view_loader_contract_changed");
      }
      return code.replace(
        dynamicViewLoader,
        "throw new Error('phase5_stage_view_engine_forbidden');",
      );
    },
  }],
  build: {
    ssr: fileURLToPath(new URL("./src/stage.ts", import.meta.url)),
    outDir: fileURLToPath(new URL("./artifact", import.meta.url)),
    emptyOutDir: true,
    target: "node22",
    minify: false,
    sourcemap: false,
    rollupOptions: {
      external: (id) => builtins.has(id),
      output: {
        entryFileNames: "stage.mjs",
      },
      codeSplitting: false,
    },
  },
  ssr: { noExternal: true },
});
