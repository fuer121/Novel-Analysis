import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateEvidenceManifest } from "../../scripts/phase5-acceptance.mjs";

const EXPECTED_SHA = "d922877ce826d6794daf096fe76d4be0ec96650c";

async function fixture(overrides = {}) {
  const cwd = await mkdtemp(join(tmpdir(), "phase5-acceptance-"));
  const artifactPath = "artifacts/contracts.json";
  const artifact = Buffer.from("focused contract evidence\n");
  await mkdir(join(cwd, "artifacts"));
  await writeFile(join(cwd, artifactPath), artifact);
  const evidence = {
    command: "npm run test:contracts",
    exitCode: 0,
    commitSha: EXPECTED_SHA,
    artifactPath,
    artifactSha256: createHash("sha256").update(artifact).digest("hex"),
    ...overrides,
  };
  return { cwd, manifest: { evidence: [evidence] } };
}

test("accepts complete local engineering evidence", async () => {
  const { cwd, manifest } = await fixture();

  const result = await validateEvidenceManifest(manifest, { cwd, expectedCommitSha: EXPECTED_SHA });

  assert.deepEqual(result, { ok: true, evidenceCount: 1, commitSha: EXPECTED_SHA });
});

for (const [name, overrides, code] of [
  ["missing command", { command: "" }, "command_missing"],
  ["non-zero exit", { exitCode: 1 }, "command_failed"],
  ["commit mismatch", { commitSha: "a".repeat(40) }, "commit_mismatch"],
  ["fingerprint mismatch", { artifactSha256: "0".repeat(64) }, "fingerprint_mismatch"],
]) {
  test(`rejects ${name}`, async () => {
    const { cwd, manifest } = await fixture(overrides);

    await assert.rejects(
      validateEvidenceManifest(manifest, { cwd, expectedCommitSha: EXPECTED_SHA }),
      (error) => error.code === code,
    );
  });
}

test("rejects a missing artifact", async () => {
  const { cwd, manifest } = await fixture({ artifactPath: "artifacts/missing.json" });

  await assert.rejects(
    validateEvidenceManifest(manifest, { cwd, expectedCommitSha: EXPECTED_SHA }),
    (error) => error.code === "artifact_missing",
  );
});

test("rejects duplicate or contradictory evidence", async () => {
  const { cwd, manifest } = await fixture();
  manifest.evidence.push({ ...manifest.evidence[0], exitCode: 1 });

  await assert.rejects(
    validateEvidenceManifest(manifest, { cwd, expectedCommitSha: EXPECTED_SHA }),
    (error) => error.code === "evidence_duplicate",
  );
});

for (const [field, value] of [
  ["command", "npm run deploy:production"],
  ["artifactPath", "/var/lib/novel-analysis/evidence.json"],
]) {
  test(`rejects production-looking ${field}`, async () => {
    const { cwd, manifest } = await fixture({ [field]: value });

    await assert.rejects(
      validateEvidenceManifest(manifest, { cwd, expectedCommitSha: EXPECTED_SHA }),
      (error) => error.code === "production_input",
    );
  });
}
