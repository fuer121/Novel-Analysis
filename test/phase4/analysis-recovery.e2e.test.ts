import { afterEach, describe, expect, it } from "vitest";

import {
  startPhase4ProcessHarness,
  type Phase4ProcessHarness,
} from "./helpers/phase4-harness.js";

describe("Phase 4 analysis recovery and idempotency", () => {
  let harness: Phase4ProcessHarness | undefined;

  afterEach(async () => {
    await harness?.stop();
  });

  it("reuses a committed part after Worker termination, lease recovery, duplicate create, and outbox replay", async () => {
    harness = await startPhase4ProcessHarness();
    const fixture = await harness.prepareGoldenFixtures();
    const templateResponse = await fixture.requestAs("owner", `/books/${fixture.bookId}/analysis-templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookId: fixture.bookId,
        name: "Phase 4 recovery template",
        prompt: "PHASE4_RECOVERY_PROMPT",
        outputSchema: {
          type: "object",
          properties: {
            items: { type: "array", items: { type: "object", properties: { label: { type: "string" } }, required: ["label"], additionalProperties: false } },
            summary: { type: "string" },
          },
          required: ["items", "summary"],
          additionalProperties: false,
        },
        indexGroupId: fixture.groupId,
      }),
    });
    expect(templateResponse.status).toBe(201);
    const template = (await templateResponse.json() as { template: { id: string; currentVersionId: string } }).template;
    const previewResponse = await fixture.requestAs("owner", `/books/${fixture.bookId}/advanced-analysis/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId: fixture.bookId, templateId: template.id, mode: "full_text", startChapter: 1, endChapter: 2 }),
    });
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json() as { templateVersionId: string; scopeHash: string };
    const createBody = {
      bookId: fixture.bookId,
      templateId: template.id,
      templateVersionId: preview.templateVersionId,
      mode: "full_text",
      startChapter: 1,
      endChapter: 2,
      scopeHash: preview.scopeHash,
      idempotencyKey: "phase4-recovery-create",
    };
    const gate = fixture.blockPart(2);
    const firstResponse = await fixture.requestAs("owner", `/books/${fixture.bookId}/advanced-analysis`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(createBody),
    });
    const replayResponse = await fixture.requestAs("owner", `/books/${fixture.bookId}/advanced-analysis`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(createBody),
    });
    expect(firstResponse.status).toBe(201);
    expect(replayResponse.status).toBe(201);
    const first = await firstResponse.json() as { run: { id: string }; job: { id: string } };
    const replayed = await replayResponse.json() as { run: { id: string }; job: { id: string } };
    expect(replayed).toMatchObject({ run: { id: first.run.id }, job: { id: first.job.id } });

    await gate.started;
    expect(await harness.database.selectFrom("analysis_parts").select("status")
      .where("run_id", "=", first.run.id).where("position", "=", 1).executeTakeFirstOrThrow()).toEqual({ status: "completed" });
    await harness.killWorker();
    gate.release();
    await harness.database.updateTable("job_steps").set({ lease_expires_at: new Date(0) })
      .where("job_id", "=", first.job.id).where("status", "=", "running").execute();
    await harness.restartWorker();
    const terminal = await fixture.waitForRun(first.run.id);
    expect(terminal).toMatchObject({ status: "completed", completedParts: 2, totalParts: 2 });

    const partCalls = fixture.difyCallsSince(0).flatMap((call) => {
      const context = JSON.parse(String(call.inputs.context_json)) as { stage?: string; position?: number };
      return context.stage === "part" ? [context.position] : [];
    });
    expect(partCalls.filter((position) => position === 1)).toHaveLength(1);
    expect(await harness.database.selectFrom("analysis_runs").select(["id", "result_ciphertext"]).where("job_id", "=", first.job.id).execute()).toEqual([
      { id: first.run.id, result_ciphertext: expect.any(Buffer) },
    ]);
    expect(await harness.database.selectFrom("analysis_parts").select("id").where("run_id", "=", first.run.id).where("position", "=", 1).execute()).toHaveLength(1);
    expect(await harness.database.selectFrom("job_events").select("id").where("job_id", "=", first.job.id).where("type", "=", "completed").execute()).toHaveLength(1);

    const attemptsBeforeReplay = await harness.database.selectFrom("job_attempts").select(["attempt_no", "status"]).where("step_id", "in", harness.database.selectFrom("job_steps").select("id").where("job_id", "=", first.job.id)).orderBy("attempt_no").execute();
    expect(attemptsBeforeReplay).toEqual([
      { attempt_no: 1, status: "abandoned" },
      { attempt_no: 2, status: "completed" },
    ]);
    const outbox = await harness.database.selectFrom("job_outbox").select("id").where("job_id", "=", first.job.id).orderBy("created_at").executeTakeFirstOrThrow();
    await harness.database.updateTable("job_outbox").set({ delivered_at: null }).where("id", "=", outbox.id).execute();
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const row = await harness.database.selectFrom("job_outbox").select("delivered_at").where("id", "=", outbox.id).executeTakeFirstOrThrow();
      if (row.delivered_at) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect((await harness.database.selectFrom("job_outbox").select("delivered_at").where("id", "=", outbox.id).executeTakeFirstOrThrow()).delivered_at).toBeInstanceOf(Date);
    expect(await harness.database.selectFrom("job_attempts").select(["attempt_no", "status"]).where("step_id", "in", harness.database.selectFrom("job_steps").select("id").where("job_id", "=", first.job.id)).orderBy("attempt_no").execute()).toEqual(attemptsBeforeReplay);
    expect(await harness.database.selectFrom("job_events").select("id").where("job_id", "=", first.job.id).where("type", "=", "completed").execute()).toHaveLength(1);
  });
});
