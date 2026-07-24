import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../..", import.meta.url));
const artifact = fileURLToPath(new URL("./artifact/stage.mjs", import.meta.url));
const vite = fileURLToPath(new URL("../../node_modules/vite/bin/vite.js", import.meta.url));

execFileSync(process.execPath, [vite, "build", "--config", `${directory}vite.config.ts`], {
  cwd: root,
  stdio: "pipe",
  env: { ...process.env, TZ: "UTC", SOURCE_DATE_EPOCH: "0" },
});
const normalized = readFileSync(artifact, "utf8").replace(/[ \t]+$/gm, "");
writeFileSync(artifact, normalized, "utf8");
const digest = createHash("sha256").update(normalized).digest("hex");
writeFileSync(`${directory}artifact.sha256`, `${digest}  artifact/stage.mjs\n`, "utf8");
