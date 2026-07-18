import { randomUUID } from "node:crypto";

import { sql } from "kysely";

import type { DatabaseConnection } from "@novel-analysis/database";

import type { BossSender } from "./boss.js";

const DEFAULT_CLAIM_DURATION_MS = 30_000;

type ClaimedOutbox = {
  id: string;
  jobId: string;
  topic: string;
  claimId: string;
};

export class OutboxClaimLostError extends Error {
  constructor() {
    super("Outbox claim changed before delivery could be marked");
    this.name = "OutboxClaimLostError";
  }
}

export class OutboxDispatcher {
  constructor(private readonly options: {
    database: DatabaseConnection;
    boss: BossSender;
    dispatcherId: string;
  }) {}

  async dispatchNext(): Promise<boolean> {
    const claimed = await this.claimNext();
    if (!claimed) return false;

    try {
      await this.options.boss.send(
        claimed.topic,
        { jobId: claimed.jobId, outboxId: claimed.id },
        { singletonKey: `outbox:${claimed.id}` },
      );
    } catch (error) {
      await this.releaseClaim(claimed);
      throw error;
    }

    await this.markDelivered(claimed);
    return true;
  }

  private claimNext(): Promise<ClaimedOutbox | null> {
    return this.options.database.transaction().execute(async (transaction) => {
      const row = await transaction.selectFrom("job_outbox")
        .select(["id", "job_id", "topic"])
        .where("delivered_at", "is", null)
        .where("available_at", "<=", sql<Date>`now()`)
        .where((expression) => expression.or([
          expression("claimed_by", "is", null),
          expression("claim_expires_at", "is", null),
          expression("claim_expires_at", "<=", sql<Date>`now()`),
        ]))
        .orderBy("available_at")
        .orderBy("id")
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!row) return null;

      const claimId = `${this.options.dispatcherId}:${randomUUID()}`;
      await transaction.updateTable("job_outbox").set({
        claimed_by: claimId,
        claim_expires_at: sql<Date>`
          now() + ${DEFAULT_CLAIM_DURATION_MS} * interval '1 millisecond'
        `,
      }).where("id", "=", row.id).executeTakeFirstOrThrow();

      return {
        id: row.id,
        jobId: row.job_id,
        topic: row.topic,
        claimId,
      };
    });
  }

  private async releaseClaim(claimed: ClaimedOutbox): Promise<void> {
    await this.options.database.transaction().execute(async (transaction) => {
      await transaction.updateTable("job_outbox").set({
        claimed_by: null,
        claim_expires_at: null,
      }).where("id", "=", claimed.id)
        .where("claimed_by", "=", claimed.claimId)
        .where("delivered_at", "is", null)
        .execute();
    });
  }

  private async markDelivered(claimed: ClaimedOutbox): Promise<void> {
    await this.options.database.transaction().execute(async (transaction) => {
      const result = await transaction.updateTable("job_outbox").set({
        delivered_at: sql<Date>`now()`,
        claimed_by: null,
        claim_expires_at: null,
      }).where("id", "=", claimed.id)
        .where("claimed_by", "=", claimed.claimId)
        .where("delivered_at", "is", null)
        .executeTakeFirst();
      if (result.numUpdatedRows !== 1n) throw new OutboxClaimLostError();
    });
  }
}
