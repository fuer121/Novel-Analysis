import { RebuildStepRefSchema, type RebuildStepRef } from "@novel-analysis/contracts";
import {
  getBookAnalysisReadiness,
  sql,
  type DatabaseConnection,
} from "@novel-analysis/database";
import {
  ensureBaselineBaseGroup,
  L1JobService,
  L2JobService,
  loadApprovedIndexingBaseline,
  PostgresStepLeaseService,
  type ClaimedStep,
} from "@novel-analysis/jobs";

import { failImportClaim } from "./library-executor.js";

type RebuildDisposition =
  | "deferred"
  | "completed"
  | "failed"
  | "already-completed"
  | "paused-boundary"
  | "discarded-cancelled"
  | "terminal-noop";

export class RebuildExecutor {
  private readonly leases: PostgresStepLeaseService;

  constructor(private readonly options: {
    database: DatabaseConnection;
    deferDelayMs?: number;
  }) {
    this.leases = new PostgresStepLeaseService({ database: options.database });
  }

  async execute(claim: ClaimedStep): Promise<{ disposition: RebuildDisposition }> {
    if (claim.kind !== "library-rebuild-book") {
      throw new Error(`Unsupported rebuild step kind: ${claim.kind}`);
    }
    if (!await this.isCurrent(claim)) return { disposition: "terminal-noop" };
    const stored = await this.options.database.selectFrom("job_steps as s")
      .innerJoin("jobs as j", "j.id", "s.job_id")
      .select(["s.output_ref", "j.requested_by"])
      .where("s.id", "=", claim.stepId).where("j.id", "=", claim.jobId)
      .executeTakeFirst();
    if (!stored) return { disposition: "terminal-noop" };
    const ref = RebuildStepRefSchema.parse(stored.output_ref);
    const baseline = await loadApprovedIndexingBaseline();

    if (ref.stage === "waiting") {
      const next = await this.createL1(ref, stored.requested_by, claim.stepId);
      return this.defer(claim, next);
    }
    if (ref.stage === "l1") {
      const current = ref.l1JobId
        ? await this.childStatus(ref.l1JobId, "l1-index")
        : null;
      if (!current) return this.defer(claim, await this.createL1(ref, stored.requested_by, claim.stepId));
      if (current === "failed" || current === "cancelled") {
        return failImportClaim(this.options.database, claim, "rebuild_l1_failed");
      }
      if (current !== "completed") return this.defer(claim, ref);
      const baseGroupId = await this.options.database.transaction().execute((transaction) =>
        ensureBaselineBaseGroup(transaction, { bookId: ref.bookId, baseline }));
      const l2 = await this.createL2({ ...ref, baseGroupId }, stored.requested_by, claim.stepId);
      return this.defer(claim, l2);
    }
    if (ref.stage === "l2") {
      const current = ref.l2JobId
        ? await this.childStatus(ref.l2JobId, "l2-index")
        : null;
      if (!current) {
        const recovered = await this.createL2(ref, stored.requested_by, claim.stepId);
        return this.defer(claim, recovered);
      }
      if (current === "failed" || current === "cancelled") {
        return failImportClaim(this.options.database, claim, "rebuild_l2_failed");
      }
      if (current !== "completed") return this.defer(claim, ref);
      return this.defer(claim, { ...ref, stage: "verify" });
    }

    const readiness = await getBookAnalysisReadiness(this.options.database, ref.bookId);
    if (!readiness.analysisAvailable) {
      return failImportClaim(this.options.database, claim, "rebuild_verification_failed");
    }
    return this.leases.completeStep(claim, ref);
  }

  private async isCurrent(claim: ClaimedStep): Promise<boolean> {
    const row = await this.options.database.selectFrom("job_steps as s")
      .innerJoin("job_attempts as a", "a.step_id", "s.id")
      .select("s.id")
      .where("s.id", "=", claim.stepId)
      .where("s.job_id", "=", claim.jobId)
      .where("s.status", "=", "running")
      .where("s.lease_owner", "=", claim.workerId)
      .where("s.attempt_count", "=", claim.attemptNo)
      .where("s.lease_expires_at", "=", claim.leaseExpiresAt)
      .where("s.lease_expires_at", ">", sql<Date>`clock_timestamp()`)
      .where("a.id", "=", claim.attemptId)
      .where("a.attempt_no", "=", claim.attemptNo)
      .where("a.worker_id", "=", claim.workerId)
      .where("a.status", "=", "running")
      .executeTakeFirst();
    return !!row;
  }

  private defer(claim: ClaimedStep, ref: RebuildStepRef) {
    return this.leases.deferStep(claim, ref, this.options.deferDelayMs ?? 1_000);
  }

  private async childStatus(jobId: string, type: "l1-index" | "l2-index") {
    const child = await this.options.database.selectFrom("jobs").select(["type", "status"])
      .where("id", "=", jobId).executeTakeFirst();
    return child?.type === type ? child.status : null;
  }

  private async createL1(
    ref: RebuildStepRef,
    requestedBy: string,
    parentStepId: string,
  ): Promise<RebuildStepRef> {
    const service = new L1JobService(this.options.database);
    const preview = await service.preview({ bookId: ref.bookId });
    const child = await service.create({
      bookId: ref.bookId,
      requestedBy,
      requestId: `library-rebuild:${parentStepId}:l1`,
      scopeHash: preview.scopeHash,
    });
    return { ...ref, stage: "l1", l1JobId: child.id };
  }

  private async createL2(
    ref: RebuildStepRef,
    requestedBy: string,
    parentStepId: string,
  ): Promise<RebuildStepRef> {
    const baseline = await loadApprovedIndexingBaseline();
    const baseGroupId = ref.baseGroupId ?? await this.options.database.transaction()
      .execute((transaction) => ensureBaselineBaseGroup(transaction, {
        bookId: ref.bookId,
        baseline,
      }));
    const last = await this.options.database.selectFrom("chapters").select("chapter_index")
      .where("book_id", "=", ref.bookId).orderBy("chapter_index", "desc").executeTakeFirst();
    const scope = {
      bookId: ref.bookId,
      groupId: baseGroupId,
      startChapter: 1,
      endChapter: Math.max(1, last?.chapter_index ?? 1),
      mode: "missing" as const,
      force: false,
    };
    const service = new L2JobService(this.options.database);
    const preview = await service.preview(scope);
    const child = await service.create({
      ...scope,
      requestedBy,
      requestId: `library-rebuild:${parentStepId}:l2`,
      scopeHash: preview.scopeHash,
    });
    return {
      ...ref,
      stage: "l2",
      baseGroupId,
      l2JobId: child.id,
    };
  }
}
