import { afterEach, describe, expect, it } from "vitest";

import { REBUILD_GOLDEN } from "./fixtures/golden-query.js";
import { createPhase5Harness } from "./helpers/phase5-harness.js";

describe("Phase 5 rebuild recovery", () => {
  let harness: Awaited<ReturnType<typeof createPhase5Harness>> | undefined;
  afterEach(async () => harness?.destroy());

  it("recovers leases and replayed wakes without duplicate children, then recalls the golden fact", async () => {
    harness = await createPhase5Harness();
    const stale = (await harness.claimParent("killed-worker"))!;
    await harness.expire(stale);
    const recovered = (await harness.claimParent("recovery-worker"))!;
    await expect(harness.executor().execute(stale))
      .resolves.toEqual({ disposition: "terminal-noop" });
    await expect(harness.executor().execute(recovered))
      .resolves.toEqual({ disposition: "deferred" });
    let detail = await harness.detail();
    const l1JobId = detail!.steps[0]!.ref.l1JobId!;

    const replayClaims = await Promise.all([
      harness.claimParent("wake-replay-a"),
      harness.claimParent("wake-replay-b"),
    ]);
    for (const claim of replayClaims) {
      if (claim) await harness.executor().execute(claim);
    }
    detail = await harness.detail();
    expect(detail!.steps[0]!.ref.l1JobId).toBe(l1JobId);
    expect(await harness.postgres.db.selectFrom("jobs").select("id")
      .where("type", "=", "l1-index").execute()).toHaveLength(1);

    await expect(harness.runChild(l1JobId, "l1-index"))
      .resolves.toEqual({ disposition: "completed" });
    const afterL1 = (await harness.claimParent("after-l1"))!;
    await harness.executor().execute(afterL1);
    detail = await harness.detail();
    const l2JobId = detail!.steps[0]!.ref.l2JobId!;
    expect(await harness.postgres.db.selectFrom("jobs").select("id")
      .where("type", "=", "l2-index").execute()).toHaveLength(1);

    const l2Replay = (await harness.claimParent("l2-replay"))!;
    await harness.executor().execute(l2Replay);
    expect((await harness.detail())!.steps[0]!.ref.l2JobId).toBe(l2JobId);
    await expect(harness.runChild(l2JobId, "l2-index"))
      .resolves.toEqual({ disposition: "completed" });
    await harness.executor().execute((await harness.claimParent("to-verify"))!);
    await expect(harness.executor().execute((await harness.claimParent("verify"))!))
      .resolves.toEqual({ disposition: "completed" });
    expect((await harness.detail())!.job.status).toBe("completed");

    const stored = await harness.postgres.db.selectFrom("l2_facts as f")
      .innerJoin("chapters as c", "c.id", "f.chapter_id")
      .select([
        "f.subject_key",
        "f.fact_ciphertext",
        "f.fact_nonce",
        "f.fact_tag",
        "f.fact_key_version",
        "c.chapter_index",
      ]).executeTakeFirstOrThrow();
    expect({
      subjectKey: stored.subject_key,
      chapterIndex: stored.chapter_index,
      fact: harness.cipher.decrypt({
        ciphertext: stored.fact_ciphertext,
        nonce: stored.fact_nonce,
        tag: stored.fact_tag,
        keyVersion: stored.fact_key_version,
      }),
    }).toEqual(REBUILD_GOLDEN);
  });
});
