import { sql } from "kysely";

import {
  createContentCipher,
  createLibraryRepository,
} from "@novel-analysis/database";
import { FakeDifyAdapter, type FakeDifyScript } from "@novel-analysis/dify";
import {
  LibraryRebuildJobService,
  PostgresStepLeaseService,
  type ClaimedStep,
} from "@novel-analysis/jobs";
import {
  createDisposablePostgres,
  type DisposablePostgres,
} from "../../../packages/database/src/testing/postgres.js";
import { LibraryImportExecutor } from "../../../apps/worker/src/library-executor.js";
import { RebuildExecutor } from "../../../apps/worker/src/rebuild-executor.js";

import { REBUILD_GOLDEN } from "../fixtures/golden-query.js";

export async function createPhase5Harness() {
  const postgres: DisposablePostgres = await createDisposablePostgres();
  const cipher = createContentCipher({
    activeKeyVersion: "phase5-test",
    keys: { "phase5-test": Buffer.alloc(32, 12) },
  });
  const adminId = (await postgres.db.insertInto("users").values({
    display_name: "Phase 5 Admin",
    role: "admin",
    status: "active",
  }).returning("id").executeTakeFirstOrThrow()).id;
  const library = createLibraryRepository(postgres.db, cipher);
  const bookId = (await library.createBook({
    title: "Phase 5 Recovery",
    createdBy: adminId,
  })).id;
  await library.insertChapter({
    bookId,
    chapterIndex: REBUILD_GOLDEN.chapterIndex,
    title: "白鹿回返",
    plaintext: "受控测试章节正文",
    contentHmac: "phase5-controlled-hmac",
    sourceVersion: "phase5-source-v1",
  });
  const parentJobId = (await new LibraryRebuildJobService(postgres.db).create({
    requestedBy: adminId,
    requestId: "phase5-recovery",
  })).id;

  const leases = () => new PostgresStepLeaseService({
    database: postgres.db,
    leaseDurationMs: 60_000,
  });
  const executor = () => new RebuildExecutor({ database: postgres.db, deferDelayMs: 0 });

  async function claimParent(workerId: string = crypto.randomUUID()) {
    return leases().claimNext(parentJobId, workerId, new Date());
  }

  async function expire(claim: ClaimedStep) {
    await postgres.db.updateTable("job_steps").set({
      lease_expires_at: sql<Date>`clock_timestamp() - interval '1 second'`,
    }).where("id", "=", claim.stepId).execute();
  }

  async function runChild(jobId: string, target: "l1-index" | "l2-index") {
    const claim = await leases().claimNext(jobId, `${target}-worker`, new Date());
    if (!claim) throw new Error(`${target} child claim missing`);
    let script: FakeDifyScript;
    if (target === "l1-index") {
      script = { target, invocationKey: claim.stepId, output: {
          route_schema_version: "l1-route-v1",
          route_entities: [{ name: "白鹿", type: "character", aliases: [], role: "signal", note: "回返" }],
          route_keywords: ["白鹿", "回返"],
          signals: [],
          category_scores: { event: 1 },
        } };
    } else {
      script = { target, invocationKey: claim.stepId, output: {
          chapter_index: REBUILD_GOLDEN.chapterIndex,
          chapter_title: "白鹿回返",
          facts: [{
            category: "event",
            entity: "白鹿",
            aliases: [],
            tags: ["回返"],
            related_entities: [],
            fact_type: "event",
            fact: REBUILD_GOLDEN.fact,
            evidence: ["山门前留下信号"],
            importance: 0.8,
            confidence: 0.9,
            scope_eligible: true,
            scope_basis: "章节明确陈述",
            transformation_eligible: false,
            scope_fields_complete: true,
            creature_type: "",
            original_form: "",
            qualification_evidence: [],
            subject_key: REBUILD_GOLDEN.subjectKey,
            identity_basis: "明确命名",
          }],
        } };
    }
    return new LibraryImportExecutor({
      database: postgres.db,
      adapter: new FakeDifyAdapter([script]),
      cipher,
      hmacKey: Buffer.from("phase5-hmac"),
    }).execute(claim);
  }

  return {
    postgres,
    cipher,
    bookId,
    parentJobId,
    claimParent,
    expire,
    executor,
    runChild,
    detail: () => new LibraryRebuildJobService(postgres.db).get(parentJobId),
    destroy: () => postgres.destroy(),
  };
}
