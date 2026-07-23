import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PRODUCTION_PATTERN = /(^|[^a-z])(prod|production)([^a-z]|$)|\/var\/lib\/|\b(ssh|deploy|cutover)\b/i;

export class EvidenceValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EvidenceValidationError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new EvidenceValidationError(code, message);
}

function validateLocalInput(command, artifactPath, cwd) {
  if (PRODUCTION_PATTERN.test(command) || PRODUCTION_PATTERN.test(artifactPath)) {
    fail("production_input", "Production-looking commands and artifact paths are prohibited");
  }
  const artifact = resolve(cwd, artifactPath);
  const root = `${resolve(cwd)}/`;
  if (isAbsolute(artifactPath) || !artifact.startsWith(root)) {
    fail("production_input", "Artifact path must remain inside the local working directory");
  }
  return artifact;
}

export async function validateEvidenceManifest(manifest, options) {
  const expectedCommitSha = options?.expectedCommitSha;
  const cwd = options?.cwd ?? process.cwd();
  if (!SHA_PATTERN.test(expectedCommitSha ?? "")) {
    fail("expected_commit_invalid", "Expected commit SHA must be a lowercase 40-character SHA");
  }
  if (!Array.isArray(manifest?.evidence) || manifest.evidence.length === 0) {
    fail("evidence_missing", "Manifest must contain at least one evidence entry");
  }

  const commands = new Set();
  const artifacts = new Set();
  for (const entry of manifest.evidence) {
    if (typeof entry?.command !== "string" || entry.command.trim() === "") {
      fail("command_missing", "Every evidence entry must record a command");
    }
    if (commands.has(entry.command) || artifacts.has(entry.artifactPath)) {
      fail("evidence_duplicate", "Commands and artifact paths must be unique");
    }
    commands.add(entry.command);
    artifacts.add(entry.artifactPath);

    if (entry.exitCode !== 0) fail("command_failed", `Command failed: ${entry.command}`);
    if (entry.commitSha !== expectedCommitSha) {
      fail("commit_mismatch", `Evidence commit does not match ${expectedCommitSha}`);
    }
    if (typeof entry.artifactPath !== "string" || entry.artifactPath.trim() === "") {
      fail("artifact_missing", "Every evidence entry must record an artifact path");
    }
    if (!SHA256_PATTERN.test(entry.artifactSha256 ?? "")) {
      fail("fingerprint_mismatch", "Artifact SHA-256 must be a lowercase hexadecimal fingerprint");
    }

    const artifact = validateLocalInput(entry.command, entry.artifactPath, cwd);
    let content;
    try {
      content = await readFile(artifact);
    } catch (error) {
      if (error?.code === "ENOENT") fail("artifact_missing", `Artifact does not exist: ${entry.artifactPath}`);
      throw error;
    }
    const actualFingerprint = createHash("sha256").update(content).digest("hex");
    if (actualFingerprint !== entry.artifactSha256) {
      fail("fingerprint_mismatch", `Artifact fingerprint mismatch: ${entry.artifactPath}`);
    }
  }

  return { ok: true, evidenceCount: manifest.evidence.length, commitSha: expectedCommitSha };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  try {
    const manifestPath = argument("--manifest");
    const expectedCommitSha = argument("--expected-sha");
    if (!manifestPath) fail("manifest_missing", "Usage: --manifest <local-json> --expected-sha <commit>");
    const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
    const result = await validateEvidenceManifest(manifest, { expectedCommitSha });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code ?? "manifest_invalid", message: error.message })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
