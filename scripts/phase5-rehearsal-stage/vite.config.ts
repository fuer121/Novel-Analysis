import { builtinModules } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const canonicalBaseline = JSON.stringify(JSON.parse(readFileSync(
  fileURLToPath(new URL("../../config/indexing-baseline.json", import.meta.url)),
  "utf8",
)));

function replaceExactly(code: string, search: string, replacement: string, label: string): string {
  if (code.split(search).length !== 2) throw new Error(`${label}_contract_changed`);
  return code.replace(search, replacement);
}

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
  }, {
    name: "phase5-inline-indexing-baseline",
    transform(code, id) {
      if (!id.endsWith("/packages/jobs/src/library/rebuild-job.ts")) return;
      let transformed = replaceExactly(
        code,
        'import { readFile } from "node:fs/promises";\n',
        "",
        "indexing_baseline_read_import",
      );
      transformed = replaceExactly(
        transformed,
        'const BASELINE_URL = new URL("../../../../config/indexing-baseline.json", import.meta.url);',
        `const PHASE5_APPROVED_INDEXING_BASELINE = ${canonicalBaseline};`,
        "indexing_baseline_url",
      );
      return replaceExactly(
        transformed,
        'JSON.parse(await readFile(BASELINE_URL, "utf8"))',
        "structuredClone(PHASE5_APPROVED_INDEXING_BASELINE)",
        "indexing_baseline_read",
      );
    },
  }, {
    name: "phase5-remove-dynamic-dependency-primitives",
    transform(code, id) {
      if (id.endsWith("/zod/v4/core/util.js")) {
        return replaceExactly(
          code,
          'new F("");',
          'throw new Error("phase5_stage_jit_disabled");',
          "zod_jit_probe",
        );
      }
      if (id.endsWith("/zod/v4/core/doc.js")) {
        return replaceExactly(
          code,
          '        const F = Function;\n        const args = this?.args;\n        const content = this?.content ?? [``];\n        const lines = [...content.map((x) => `  ${x}`)];\n        // console.log(lines.join("\\n"));\n        return new F(...args, lines.join("\\n"));',
          '        throw new Error("phase5_stage_jit_disabled");',
          "zod_jit_compiler",
        );
      }
      if (id.endsWith("/depd/index.js")) {
        const transformed = code.replace(
          /  \/\/ eslint-disable-next-line no-new-func\n  var deprecatedfn = new Function\([\s\S]*?\n\n  return deprecatedfn/,
          "  var deprecate = this\n"+
            "  return function phase5DeprecatedWrapper () {\n"+
            "    log.call(deprecate, message, site)\n"+
            "    return fn.apply(this, arguments)\n"+
            "  }",
        );
        if (transformed === code) throw new Error("depd_wrapper_contract_changed");
        return transformed;
      }
      if (id.endsWith("/safer-buffer/safer.js")) {
        return replaceExactly(
          code,
          "safer.kStringMaxLength = process.binding('buffer').kStringMaxLength",
          "safer.kStringMaxLength = buffer.constants && buffer.constants.MAX_STRING_LENGTH",
          "safer_buffer_binding",
        );
      }
      if (id.endsWith("/function-bind/implementation.js")) {
        return replaceExactly(
          code,
          'bound = Function(\'binder\', \'return function (\' + joiny(boundArgs, \',\') + \'){ return binder.apply(this,arguments); }\')(binder);',
          'bound = function phase5Bound () { return binder.apply(this, arguments) };',
          "function_bind_constructor",
        );
      }
      if (id.endsWith("/get-intrinsic/index.js")) {
        const dynamicIntrinsic = `var $Function = Function;

// eslint-disable-next-line consistent-return
var getEvalledConstructor = function (expressionSyntax) {
\ttry {
\t\treturn $Function('\"use strict\"; return (' + expressionSyntax + ').constructor;')();
\t} catch (e) {}
};`;
        return replaceExactly(
          code,
          dynamicIntrinsic,
          "var $Function = Function;\nvar getEvalledConstructor = function () { return undefined; };",
          "get_intrinsic_constructor",
        );
      }
    },
  }],
  build: {
    ssr: fileURLToPath(new URL("./src/stage.ts", import.meta.url)),
    outDir: fileURLToPath(new URL("./artifact", import.meta.url)),
    emptyOutDir: true,
    target: "node22",
    minify: false,
    sourcemap: false,
    rolldownOptions: {
      external: (id) => builtins.has(id),
      output: {
        entryFileNames: "stage.mjs",
        codeSplitting: false,
      },
    },
  },
  ssr: { noExternal: true },
});
