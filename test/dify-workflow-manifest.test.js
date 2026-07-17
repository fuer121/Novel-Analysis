import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("Dify workflow manifest matches every tracked workflow export", async () => {
  const manifest = JSON.parse(await fs.readFile(new URL("dify-workflows/manifest.json", root), "utf8"));
  assert.deepEqual(Object.keys(manifest.workflows), [
    "analysis_chapter",
    "analysis_summary",
    "chapter_import",
    "l1_index",
    "l2_index",
  ]);

  for (const entry of Object.values(manifest.workflows)) {
    const content = await fs.readFile(new URL(entry.file, root));
    const sha256 = crypto.createHash("sha256").update(content).digest("hex");
    assert.equal(entry.sha256, sha256, `${entry.file} hash changed; regenerate the manifest`);
  }
});
