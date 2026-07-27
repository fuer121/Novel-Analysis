import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);

async function text(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

describe("Phase 5 deployment artifacts", () => {
  it("defines reproducible non-root API and Worker image targets", async () => {
    const dockerfile = await text("deploy/phase5/Dockerfile");

    expect(dockerfile).toContain("ARG NODE_IMAGE=node:26.0.0-bookworm-slim");
    expect(dockerfile).toContain("RUN npm ci --ignore-scripts");
    expect(dockerfile).toContain("RUN npm ci --omit=dev --ignore-scripts");
    expect(dockerfile).toMatch(/FROM runtime AS api/);
    expect(dockerfile).toMatch(/FROM runtime AS worker/);
    expect(dockerfile).toContain("COPY --from=web-build");
    expect(dockerfile).toContain("USER node");
    expect(dockerfile).toContain('CMD ["npm", "run", "start", "-w", "@novel-analysis/api"]');
    expect(dockerfile).toContain('CMD ["npm", "run", "start", "-w", "@novel-analysis/worker"]');
    expect(dockerfile).not.toMatch(/COPY\s+\.\s+\./);
  });

  it("binds Compose health checks to application readiness", async () => {
    const compose = JSON.parse(await text("deploy/phase5/compose.yml"));
    const api = compose.services.api;
    const worker = compose.services.worker;

    expect(api.environment.WEB_STATIC_DIR).toBe("/app/apps/web/dist");
    expect(api.healthcheck.test.join(" ")).toContain("/api/health/ready");
    expect(worker.environment.WORKER_READY_FILE).toBe("/tmp/novel-worker.ready");
    expect(worker.healthcheck.test.join(" ")).toContain("healthcheck");
    expect(api.read_only).toBe(true);
    expect(worker.read_only).toBe(true);
    expect(api.security_opt).toContain("no-new-privileges:true");
    expect(worker.security_opt).toContain("no-new-privileges:true");
  });

  it("clears Worker readiness before validating startup configuration", async () => {
    const workerMain = await text("apps/worker/src/main.ts");

    expect(workerMain.indexOf("await prepareWorkerReadiness(readinessFile)"))
      .toBeLessThan(workerMain.indexOf('if (!databaseUrl)'));
  });

  it("keeps TLS proxying and browser security headers at the edge", async () => {
    const caddyfile = await text("deploy/phase5/Caddyfile");

    expect(caddyfile).toContain("reverse_proxy api:3000");
    expect(caddyfile).toContain("Strict-Transport-Security");
    expect(caddyfile).toContain("X-Content-Type-Options");
    expect(caddyfile).toContain("Referrer-Policy");
    expect(caddyfile).toContain("Permissions-Policy");
    expect(caddyfile).toContain("encode zstd gzip");
  });

  it("excludes local state and development artifacts from image context", async () => {
    const dockerignore = await text(".dockerignore");

    for (const entry of [
      ".git",
      "node_modules",
      ".artifacts",
      "data",
      "data-preview",
      "docs/requirements",
      "*.env",
    ]) {
      expect(dockerignore).toContain(entry);
    }
  });
});
