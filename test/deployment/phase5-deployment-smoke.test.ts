import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

const smokeModuleUrl = new URL(
  "../../scripts/phase5-deployment-smoke.ts",
  import.meta.url,
).href;
const repositoryRoot = new URL("../../", import.meta.url);

async function temporarySmokeDirectories(): Promise<string[]> {
  return (await readdir(tmpdir(), { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name.startsWith("novel-phase5-deployment-smoke-"),
    )
    .map((entry) => entry.name)
    .sort();
}

describe("Phase 5 synthetic deployment smoke", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exposes a repository-only smoke runner", async () => {
    await expect(import(smokeModuleUrl)).resolves.toHaveProperty(
      "runSyntheticDeploymentSmoke",
    );
  });

  it("validates committed artifacts and local synthetic runtime without external access", async () => {
    const { runSyntheticDeploymentSmoke } = await import(smokeModuleUrl);

    await expect(runSyntheticDeploymentSmoke()).resolves.toEqual({
      committedArtifacts: true,
      webBuild: true,
      apiSurface: true,
      apiReadiness: true,
      workerReadiness: true,
      temporaryArtifactsCleaned: true,
      realInputsAccessed: false,
      externalRuntimeAccessed: false,
    });
  });

  it("removes task-owned temporary artifacts when the smoke fails closed", async () => {
    const before = await temporarySmokeDirectories();
    vi.stubEnv("VITE_SYNTHETIC_GUARD", "1");
    const { runSyntheticDeploymentSmoke } = await import(smokeModuleUrl);

    await expect(runSyntheticDeploymentSmoke()).rejects.toThrow(
      "ambient VITE variables are not allowed",
    );
    await expect(temporarySmokeDirectories()).resolves.toEqual(before);
  });

  it("exposes a fixed command without external runtime capabilities", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("package.json", repositoryRoot), "utf8"),
    );
    const source = await readFile(
      new URL("scripts/phase5-deployment-smoke.ts", repositoryRoot),
      "utf8",
    );

    expect(packageJson.scripts["phase5:deployment:smoke"]).toBe(
      "vitest run --config vitest.deployment.config.ts",
    );
    expect(source).toContain("envDir: false");
    for (const forbidden of [
      "node:child_process",
      "node:http",
      "node:https",
      "node:net",
      "DATABASE_URL",
      "DOCKER_HOST",
      "fetch(",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
