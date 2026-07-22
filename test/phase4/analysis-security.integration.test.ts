import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import { LEGACY_ANALYSIS_GOLDEN } from "./fixtures/legacy-analysis-golden.js";
import {
  startPhase4ProcessHarness,
  type Phase4ProcessHarness,
} from "./helpers/phase4-harness.js";

const outputSchema = {
  type: "object",
  properties: {
    items: { type: "array", items: { type: "object", properties: { label: { type: "string" } }, required: ["label"], additionalProperties: false } },
    summary: { type: "string" },
  },
  required: ["items", "summary"],
  additionalProperties: false,
};

describe("Phase 4 privacy, deletion, legacy, and sentinel evidence", () => {
  let harness: Phase4ProcessHarness | undefined;

  afterEach(async () => {
    await harness?.stop();
  });

  it("isolates member content, limits administrator projection, and hard deletes only an owner terminal run", async () => {
    harness = await startPhase4ProcessHarness();
    const fixture = await harness.prepareGoldenFixtures();
    const ownerId = fixture.actorId("owner");
    const prompt = "PHASE4_DELETE_PROMPT_PLAINTEXT";
    const templateResponse = await fixture.requestAs("owner", `/books/${fixture.bookId}/analysis-templates`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookId: fixture.bookId, name: "Delete evidence", prompt, outputSchema, indexGroupId: fixture.groupId }),
    });
    expect(templateResponse.status).toBe(201);
    const template = (await templateResponse.json() as { template: { id: string } }).template;
    expect((await fixture.requestAs("member", `/books/${fixture.bookId}/analysis-templates`)).status).toBe(200);
    expect(await (await fixture.requestAs("member", `/books/${fixture.bookId}/analysis-templates`)).json()).toEqual({ templates: [] });
    expect(await (await fixture.requestAs("admin", `/books/${fixture.bookId}/analysis-templates`)).json()).toEqual({ templates: [] });
    expect((await fixture.requestAs("member", `/books/${fixture.bookId}/analysis-templates/${template.id}`)).status).toBe(404);
    expect((await fixture.requestAs("admin", `/books/${fixture.bookId}/analysis-templates/${template.id}`)).status).toBe(404);

    const previewResponse = await fixture.requestAs("owner", `/books/${fixture.bookId}/advanced-analysis/preview`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookId: fixture.bookId, templateId: template.id, mode: "full_text", startChapter: 1, endChapter: 2 }),
    });
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json() as { templateVersionId: string; scopeHash: string };
    const gate = fixture.blockPart(1);
    const createdResponse = await fixture.requestAs("owner", `/books/${fixture.bookId}/advanced-analysis`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookId: fixture.bookId, templateId: template.id, templateVersionId: preview.templateVersionId, mode: "full_text", startChapter: 1, endChapter: 2, scopeHash: preview.scopeHash, idempotencyKey: "phase4-delete" }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { run: { id: string }; job: { id: string } };
    await gate.started;

    expect((await fixture.requestAs("member", `/books/${fixture.bookId}/advanced-analysis/${created.run.id}`)).status).toBe(404);
    expect((await fixture.requestAs("admin", `/books/${fixture.bookId}/advanced-analysis/${created.run.id}`)).status).toBe(404);
    expect(await (await fixture.requestAs("member", `/books/${fixture.bookId}/advanced-analysis`)).json()).toEqual({ runs: [] });
    expect((await fixture.requestAs("admin", `/books/${fixture.bookId}/advanced-analysis`)).status).toBe(404);
    for (const actor of ["owner", "member", "admin"] as const) {
      const response = await fixture.requestAs(actor, `/books/${fixture.bookId}/advanced-analysis/${created.run.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}" });
      expect(response.status).toBe(actor === "owner" ? 409 : 404);
    }

    const metadataResponse = await fixture.requestAs("admin", "/admin/advanced-analysis");
    expect(metadataResponse.status).toBe(200);
    const metadata = await metadataResponse.json() as { runs: Array<Record<string, unknown>> };
    expect(metadata.runs[0]).toMatchObject({ id: created.run.id, jobId: created.job.id, bookId: fixture.bookId, createdBy: ownerId });
    expect(Object.keys(metadata.runs[0]!).sort()).toEqual(["bookId", "completedParts", "createdAt", "createdBy", "errorCode", "id", "jobId", "mode", "status", "totalParts", "updatedAt"].sort());
    expect(JSON.stringify(metadata)).not.toContain(prompt);
    const cancelledResponse = await fixture.requestAs("admin", `/admin/advanced-analysis/${created.run.id}/control`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel", requestId: "phase4-admin-cancel" }),
    });
    expect(cancelledResponse.status).toBe(200);
    expect(JSON.stringify(await cancelledResponse.json())).not.toContain(prompt);
    gate.release();
    expect(await fixture.waitForRun(created.run.id)).toMatchObject({ status: "cancelled" });
    for (const actor of ["member", "admin"] as const) {
      expect((await fixture.requestAs(actor, `/books/${fixture.bookId}/advanced-analysis/${created.run.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(404);
    }

    const stepIds = (await harness.database.selectFrom("job_steps").select("id").where("job_id", "=", created.job.id).execute()).map((step) => step.id);
    const deleted = await fixture.requestAs("owner", `/books/${fixture.bookId}/advanced-analysis/${created.run.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(deleted.status).toBe(204);
    const graphCounts = await Promise.all([
      harness.database.selectFrom("analysis_runs").select("id").where("id", "=", created.run.id).execute(),
      harness.database.selectFrom("analysis_parts").select("id").where("run_id", "=", created.run.id).execute(),
      harness.database.selectFrom("jobs").select("id").where("id", "=", created.job.id).execute(),
      harness.database.selectFrom("job_steps").select("id").where("job_id", "=", created.job.id).execute(),
      harness.database.selectFrom("job_attempts").select("id").where("step_id", "in", stepIds).execute(),
      harness.database.selectFrom("job_events").select("id").where("job_id", "=", created.job.id).execute(),
      harness.database.selectFrom("job_outbox").select("id").where("job_id", "=", created.job.id).execute(),
    ]);
    expect(graphCounts.map((rows) => rows.length)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    const audit = await harness.database.selectFrom("audit_logs").selectAll().where("action", "=", "advanced_analysis.deleted").where("target_id", "=", created.run.id).executeTakeFirstOrThrow();
    expect(audit).toMatchObject({ actor_user_id: ownerId, metadata: { bookId: fixture.bookId, jobId: created.job.id, status: "cancelled" } });
    expect(JSON.stringify(audit)).not.toContain(prompt);
  });

  it("serves the accepted legacy fixture through GET-only routes", async () => {
    harness = await startPhase4ProcessHarness();
    const fixture = await harness.prepareGoldenFixtures();
    const expected = { ...LEGACY_ANALYSIS_GOLDEN[0], bookId: fixture.bookId };
    const { result: _result, diagnostics: _diagnostics, ...expectedSummary } = expected;
    const list = await fixture.legacyRequestAs("owner", `/books/${fixture.bookId}/legacy-analysis`);
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ analyses: [expectedSummary] });
    const detail = await fixture.legacyRequestAs("owner", `/books/${fixture.bookId}/legacy-analysis/${expected.id}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toEqual({ analysis: expected });
    for (const actor of ["member", "admin"] as const) {
      expect((await fixture.legacyRequestAs(actor, `/books/${fixture.bookId}/legacy-analysis`)).status).toBe(404);
      expect((await fixture.legacyRequestAs(actor, `/books/${fixture.bookId}/legacy-analysis/${expected.id}`)).status).toBe(404);
    }
    for (const [method, path] of [
      ["POST", `/books/${fixture.bookId}/legacy-analysis`],
      ["PATCH", `/books/${fixture.bookId}/legacy-analysis/${expected.id}`],
      ["DELETE", `/books/${fixture.bookId}/legacy-analysis/${expected.id}`],
      ["POST", `/books/${fixture.bookId}/legacy-analysis/${expected.id}/pause`],
      ["POST", `/books/${fixture.bookId}/legacy-analysis/${expected.id}/resume`],
      ["POST", `/books/${fixture.bookId}/legacy-analysis/${expected.id}/cancel`],
    ] as const) {
      expect((await fixture.legacyRequestAs("owner", path, { method, headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(404);
    }
  });

  it("keeps a successful terminal result encrypted and denies member and administrator result reads", async () => {
    harness = await startPhase4ProcessHarness();
    const fixture = await harness.prepareGoldenFixtures();
    const templateResponse = await fixture.requestAs("owner", `/books/${fixture.bookId}/analysis-templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookId: fixture.bookId,
        name: "Successful result evidence",
        prompt: "PHASE4_SUCCESS_PROMPT",
        outputSchema,
        indexGroupId: fixture.groupId,
      }),
    });
    expect(templateResponse.status).toBe(201);
    const template = (await templateResponse.json() as { template: { id: string } }).template;
    const previewResponse = await fixture.requestAs("owner", `/books/${fixture.bookId}/advanced-analysis/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId: fixture.bookId, templateId: template.id, mode: "full_text", startChapter: 1, endChapter: 1 }),
    });
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json() as { templateVersionId: string; scopeHash: string };
    const createdResponse = await fixture.requestAs("owner", `/books/${fixture.bookId}/advanced-analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookId: fixture.bookId,
        templateId: template.id,
        templateVersionId: preview.templateVersionId,
        mode: "full_text",
        startChapter: 1,
        endChapter: 1,
        scopeHash: preview.scopeHash,
        idempotencyKey: "phase4-success-result",
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { run: { id: string }; job: { id: string } };
    expect(await fixture.waitForRun(created.run.id)).toMatchObject({
      status: "completed",
      result: { summary: "phase4-result" },
    });

    const ownerDetail = await fixture.requestAs("owner", `/books/${fixture.bookId}/advanced-analysis/${created.run.id}`);
    expect(ownerDetail.status).toBe(200);
    expect(await ownerDetail.json()).toMatchObject({ run: { status: "completed", result: { summary: "phase4-result" } } });
    for (const actor of ["member", "admin"] as const) {
      const denied = await fixture.requestAs(actor, `/books/${fixture.bookId}/advanced-analysis/${created.run.id}`);
      expect(denied.status).toBe(404);
      expect(await denied.json()).toEqual({ error: "not_found" });
    }

    const successfulRows = await sql<{ table_name: string; row_json: string }>`
      select table_name, row_json::text from (
        select 'analysis_runs' table_name, row_to_json(t) row_json from analysis_runs t where id = ${created.run.id}
        union all select 'analysis_parts', row_to_json(t) from analysis_parts t where run_id = ${created.run.id}
        union all select 'jobs', row_to_json(t) from jobs t where id = ${created.job.id}
        union all select 'job_steps', row_to_json(t) from job_steps t where job_id = ${created.job.id}
        union all select 'job_events', row_to_json(t) from job_events t where job_id = ${created.job.id}
        union all select 'job_outbox', row_to_json(t) from job_outbox t where job_id = ${created.job.id}
        union all select 'job_attempts', row_to_json(t) from job_attempts t where step_id in (select id from job_steps where job_id = ${created.job.id})
        union all select 'audit_logs', row_to_json(t) from audit_logs t
      ) rows
    `.execute(harness.database);
    expect(successfulRows.rows.map((row) => row.table_name)).toEqual(expect.arrayContaining([
      "analysis_runs",
      "analysis_parts",
      "jobs",
      "job_steps",
      "job_events",
      "job_outbox",
      "job_attempts",
      "audit_logs",
    ]));
    const persistedAndMetadata = successfulRows.rows.map((row) => `${row.table_name}:${row.row_json}`).join("\n");
    expect(persistedAndMetadata).not.toContain("phase4-result");
    const ordinaryJobResponses = await Promise.all((["owner", "member", "admin"] as const).map(async (actor) => {
      const response = await fixture.requestAs(actor, `/jobs/${created.job.id}`);
      expect(response.status).toBe(200);
      return response.text();
    }));
    const ordinaryAnalysisResponses = await Promise.all([
      fixture.requestAs("owner", `/books/${fixture.bookId}/advanced-analysis`),
      fixture.requestAs("admin", "/admin/advanced-analysis"),
    ]).then((responses) => Promise.all(responses.map((response) => {
      expect(response.status).toBe(200);
      return response.text();
    })));
    expect([...ordinaryJobResponses, ...ordinaryAnalysisResponses].join("\n")).not.toContain("phase4-result");
    expect([...harness.api.logs, ...harness.worker.logs].join("\n")).not.toContain("phase4-result");
  });

  it("keeps plaintext, credentials, and controlled provider errors out of persisted and ordinary surfaces", async () => {
    harness = await startPhase4ProcessHarness();
    const fixture = await harness.prepareGoldenFixtures();
    const sentinels = [
      "PHASE4_PROMPT_PLAINTEXT",
      "PHASE4_SCHEMA_PLAINTEXT",
      "PHASE4_CHAPTER_PLAINTEXT_1",
      "PHASE4_FACT_PLAINTEXT_1",
      "PHASE4_RAW_PROVIDER_ERROR",
      "phase4-chapter-key",
      "phase4-l1-key",
      "phase4-l2-key",
      "phase4-summary-key",
      "phase4-feishu-secret",
      "phase4-owner-token",
      "phase4-owner-csrf",
      "phase4-member-token",
      "phase4-member-csrf",
      "phase4-admin-token",
      "phase4-admin-csrf",
      Buffer.alloc(32, 41).toString("base64"),
      Buffer.alloc(32, 42).toString("base64"),
    ];
    const rawProviderError = sentinels.join(":");
    fixture.failNextProvider(rawProviderError, 3);
    const templateResponse = await fixture.requestAs("owner", `/books/${fixture.bookId}/analysis-templates`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        bookId: fixture.bookId,
        name: "Sentinel evidence",
        prompt: sentinels[0],
        outputSchema: { ...outputSchema, description: sentinels[1] },
        indexGroupId: fixture.groupId,
      }),
    });
    const template = (await templateResponse.json() as { template: { id: string } }).template;
    const previewResponse = await fixture.requestAs("owner", `/books/${fixture.bookId}/advanced-analysis/preview`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookId: fixture.bookId, templateId: template.id, mode: "full_text", startChapter: 1, endChapter: 1 }),
    });
    const preview = await previewResponse.json() as { templateVersionId: string; scopeHash: string };
    const createdResponse = await fixture.requestAs("owner", `/books/${fixture.bookId}/advanced-analysis`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookId: fixture.bookId, templateId: template.id, templateVersionId: preview.templateVersionId, mode: "full_text", startChapter: 1, endChapter: 1, scopeHash: preview.scopeHash, idempotencyKey: "phase4-sentinel" }),
    });
    const created = await createdResponse.json() as { run: { id: string }; job: { id: string } };
    expect(await fixture.waitForRun(created.run.id)).toMatchObject({ status: "failed" });
    expect(fixture.controlledProviderErrors()).toEqual([rawProviderError, rawProviderError, rawProviderError]);

    const rows = await sql<{ table_name: string; row_json: string }>`
      select table_name, row_json::text from (
        select 'analysis_templates' table_name, row_to_json(t) row_json from analysis_templates t
        union all select 'analysis_template_versions', row_to_json(t) from analysis_template_versions t
        union all select 'analysis_runs', row_to_json(t) from analysis_runs t
        union all select 'analysis_parts', row_to_json(t) from analysis_parts t
        union all select 'jobs', row_to_json(t) from jobs t
        union all select 'job_steps', row_to_json(t) from job_steps t
        union all select 'job_events', row_to_json(t) from job_events t
        union all select 'job_outbox', row_to_json(t) from job_outbox t
        union all select 'job_attempts', row_to_json(t) from job_attempts t
        union all select 'audit_logs', row_to_json(t) from audit_logs t
        union all select 'chapters', row_to_json(t) from chapters t
        union all select 'l2_facts', row_to_json(t) from l2_facts t
      ) rows
    `.execute(harness.database);
    const persisted = rows.rows.map((row) => `${row.table_name}:${row.row_json}`).join("\n");
    const ordinaryResponses = await Promise.all([
      fixture.requestAs("owner", `/books/${fixture.bookId}/analysis-templates`),
      fixture.requestAs("owner", `/books/${fixture.bookId}/advanced-analysis`),
      fixture.requestAs("owner", `/jobs/${created.job.id}`),
      fixture.requestAs("admin", "/admin/advanced-analysis"),
    ]).then((responses) => Promise.all(responses.map((response) => response.text())));
    const ordinary = ordinaryResponses.join("\n");
    const logs = [...harness.api.logs, ...harness.worker.logs].join("\n");
    for (const sentinel of sentinels) {
      expect(persisted, `persisted leak: ${sentinel}`).not.toContain(sentinel);
      expect(ordinary, `ordinary API leak: ${sentinel}`).not.toContain(sentinel);
      expect(logs, `captured log leak: ${sentinel}`).not.toContain(sentinel);
    }
    const ownerDetail = await fixture.requestAs("owner", `/books/${fixture.bookId}/analysis-templates/${template.id}`);
    const authorizedDecryption = await ownerDetail.text();
    expect(authorizedDecryption).toContain(sentinels[0]);
    expect(authorizedDecryption).toContain(sentinels[1]);
    expect(fixture.difyCallsSince(0).some((call) => call.authorization === "Bearer phase4-summary-key")).toBe(true);
  });
});
