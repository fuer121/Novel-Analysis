import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";

import type { LegacyAnalysisDetail, LegacyAnalysisSummary } from "@novel-analysis/contracts";
import { createDisposablePostgres, type DisposablePostgres } from "../../../../packages/database/src/testing/postgres.js";
import { LEGACY_ANALYSIS_GOLDEN } from "../../../../test/phase4/fixtures/legacy-analysis-golden.js";

import { createApp } from "../app.js";
import { FakeFeishuOAuthAdapter } from "../auth/feishu-fake.js";
import type { ApiConfig } from "../config.js";
import { createLegacyAnalysisFixtureReader } from "../legacy-analysis.js";

const config: ApiConfig = { appOrigin: "http://legacy-analysis.test", oauthRedirectUri: "http://legacy-analysis.test/api/auth/callback", sessionCookieName: "legacy_analysis_session", oauthCorrelationCookieName: "legacy_analysis_oauth", sessionCookieSecure: false, sessionTtlMs: 60_000 };
const record = LEGACY_ANALYSIS_GOLDEN[0];

describe("legacy analysis routes", () => {
  let postgres: DisposablePostgres;
  const identities: Record<string, { id: string; cookie: string }> = {};

  beforeEach(async () => {
    postgres = await createDisposablePostgres();
    for (const [name, role] of [["owner", "member"], ["member", "member"], ["admin", "admin"]] as const) {
      const user = await postgres.db.insertInto("users").values({ display_name: name, role, status: "active" }).returning("id").executeTakeFirstOrThrow();
      const token = `${name}-token`;
      await postgres.db.insertInto("sessions").values({ user_id: user.id, token_hash: createHash("sha256").update(token).digest("hex"), csrf_token_hash: createHash("sha256").update(`${name}-csrf`).digest("hex"), expires_at: new Date(Date.now() + 60_000), revoked_at: null }).execute();
      identities[name] = { id: user.id, cookie: `${config.sessionCookieName}=${token}` };
    }
    await postgres.db.insertInto("books").values({ id: record.bookId, title: "Legacy book", status: "active", created_by: identities.owner!.id }).execute();
  });

  afterEach(async () => postgres.destroy());

  const auth = (name: string) => ({ Cookie: identities[name]!.cookie });
  const app = (legacyAnalysisReader?: ReturnType<typeof fixtureReader>) => createApp({ database: postgres.db, config, feishu: new FakeFeishuOAuthAdapter(), legacyAnalysisReader });

  function fixtureReader(records: readonly LegacyAnalysisDetail[] = LEGACY_ANALYSIS_GOLDEN) {
    const calls: Array<{ method: "list" | "get"; bookId: string; actorId: string; analysisId?: string }> = [];
    const fixture = createLegacyAnalysisFixtureReader({ ownerId: identities.owner!.id, records });
    return {
      calls,
      async list(input: { bookId: string; actorId: string }): Promise<LegacyAnalysisSummary[]> {
        calls.push({ method: "list", ...input });
        return fixture.list(input);
      },
      async get(input: { bookId: string; analysisId: string; actorId: string }): Promise<LegacyAnalysisDetail | null> {
        calls.push({ method: "get", ...input });
        return fixture.get(input);
      },
    };
  }

  it("lists and reads injected fixture history only for the authenticated book owner", async () => {
    const reader = fixtureReader();
    const list = await request(app(reader)).get(`/api/books/${record.bookId}/legacy-analysis`).set(auth("owner"));
    expect(list.status).toBe(200);
    expect(list.body.analyses).toEqual([{ id: record.id, bookId: record.bookId, name: record.name, startChapter: record.startChapter, endChapter: record.endChapter, status: record.status, readOnly: true, canResume: false, createdAt: record.createdAt, updatedAt: record.updatedAt }]);

    const detail = await request(app(reader)).get(`/api/books/${record.bookId}/legacy-analysis/${record.id}`).set(auth("owner"));
    expect(detail.status).toBe(200);
    expect(detail.body.analysis).toEqual(record);
    expect(reader.calls).toEqual([
      { method: "list", bookId: record.bookId, actorId: identities.owner!.id },
      { method: "get", bookId: record.bookId, analysisId: record.id, actorId: identities.owner!.id },
    ]);
  });

  it("returns empty and missing results without exposing production fixture data", async () => {
    const injectedEmpty = await request(app(fixtureReader([]))).get(`/api/books/${record.bookId}/legacy-analysis`).set(auth("owner"));
    expect(injectedEmpty.status).toBe(200);
    expect(injectedEmpty.body).toEqual({ analyses: [] });

    const missing = await request(app(fixtureReader())).get(`/api/books/${record.bookId}/legacy-analysis/missing-analysis`).set(auth("owner"));
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: "not_found" });

    const productionList = await request(app()).get(`/api/books/${record.bookId}/legacy-analysis`).set(auth("owner"));
    expect(productionList.status).toBe(200);
    expect(productionList.body).toEqual({ analyses: [] });
    const productionDetail = await request(app()).get(`/api/books/${record.bookId}/legacy-analysis/${record.id}`).set(auth("owner"));
    expect(productionDetail.status).toBe(404);
    expect(productionDetail.body).toEqual({ error: "not_found" });
  });

  it("hides legacy history from non-owners and administrators", async () => {
    const reader = fixtureReader();
    for (const name of ["member", "admin"]) {
      const list = await request(app(reader)).get(`/api/books/${record.bookId}/legacy-analysis`).set(auth(name));
      expect(list.status).toBe(404);
      expect(list.body).toEqual({ error: "not_found" });
      const detail = await request(app(reader)).get(`/api/books/${record.bookId}/legacy-analysis/${record.id}`).set(auth(name));
      expect(detail.status).toBe(404);
      expect(detail.body).toEqual({ error: "not_found" });
    }
    expect(reader.calls).toEqual([]);
    expect((await request(app(reader)).get(`/api/books/${record.bookId}/legacy-analysis`)).status).toBe(401);
  });

  it("does not expose legacy mutation routes", async () => {
    const paths: Array<["post" | "patch" | "delete", string]> = [
      ["post", `/api/books/${record.bookId}/legacy-analysis`],
      ["patch", `/api/books/${record.bookId}/legacy-analysis/${record.id}`],
      ["delete", `/api/books/${record.bookId}/legacy-analysis/${record.id}`],
      ["post", `/api/books/${record.bookId}/legacy-analysis/${record.id}/pause`],
      ["post", `/api/books/${record.bookId}/legacy-analysis/${record.id}/resume`],
      ["post", `/api/books/${record.bookId}/legacy-analysis/${record.id}/cancel`],
    ];
    for (const [method, path] of paths) {
      const response = await request(app(fixtureReader()))[method](path).set(auth("owner")).send({});
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "not_found" });
    }
  });
});
