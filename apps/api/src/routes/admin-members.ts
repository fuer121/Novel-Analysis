import { sql } from "kysely";
import { Router } from "express";
import { z } from "zod";

import type { DatabaseConnection } from "@novel-analysis/database";

import type { ApiConfig } from "../config.js";
import { authorize } from "../auth/authorize.js";
import { requireCsrf } from "../auth/csrf.js";
import { type AuthenticatedRequest, requireSession } from "../auth/session-middleware.js";

const createMemberSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  unionId: z.string().trim().min(1).max(500),
  role: z.enum(["admin", "member"]),
}).strict();

const updateMemberSchema = z.object({
  displayName: z.string().trim().min(1).max(200).optional(),
  role: z.enum(["admin", "member"]).optional(),
  status: z.enum(["active", "disabled"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

const memberParamsSchema = z.object({ id: z.uuid() }).strict();

function memberJson(row: {
  id: string;
  display_name: string;
  avatar_url: string | null;
  role: "admin" | "member";
  status: "active" | "disabled";
}) {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role,
    status: row.status,
  };
}

export function createAdminMembersRouter(database: DatabaseConnection, config: ApiConfig): Router {
  const router = Router();
  const session = requireSession(database, config);
  const csrf = requireCsrf(database, config);
  const admin = authorize("members:manage");

  router.get("/", session, admin, async (_request, response, next) => {
    try {
      const members = await database.selectFrom("users")
        .select(["id", "display_name", "avatar_url", "role", "status"])
        .orderBy("created_at", "asc")
        .execute();
      response.json({ members: members.map(memberJson) });
    } catch {
      next(new Error("member list failed"));
    }
  });

  router.post("/", ...csrf, admin, async (request: AuthenticatedRequest, response) => {
    const parsed = createMemberSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_request" });
      return;
    }
    try {
      const member = await database.transaction().execute(async (transaction) => {
        const row = await transaction.insertInto("users").values({
          display_name: parsed.data.displayName,
          avatar_url: null,
          role: parsed.data.role,
          status: "active",
        }).returning(["id", "display_name", "avatar_url", "role", "status"])
          .executeTakeFirstOrThrow();
        await transaction.insertInto("auth_identities").values({
          user_id: row.id,
          provider: "feishu",
          subject: parsed.data.unionId,
        }).execute();
        await transaction.insertInto("audit_logs").values({
          actor_user_id: request.auth!.userId,
          action: "member.created",
          target_type: "user",
          target_id: row.id,
          metadata: { role: parsed.data.role },
        }).execute();
        return row;
      });
      response.status(201).json({ member: memberJson(member) });
    } catch {
      response.status(409).json({ error: "member_mutation_failed" });
    }
  });

  router.patch("/:id", ...csrf, admin, async (request: AuthenticatedRequest, response, next) => {
    const params = memberParamsSchema.safeParse(request.params);
    const body = updateMemberSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      response.status(400).json({ error: "invalid_request" });
      return;
    }
    try {
      const member = await database.transaction().execute(async (transaction) => {
        const current = await transaction.selectFrom("users")
          .select("id")
          .where("id", "=", params.data.id)
          .forUpdate()
          .executeTakeFirst();
        if (!current) return null;

        const row = await transaction.updateTable("users").set({
          ...(body.data.displayName === undefined ? {} : { display_name: body.data.displayName }),
          ...(body.data.role === undefined ? {} : { role: body.data.role }),
          ...(body.data.status === undefined ? {} : { status: body.data.status }),
          updated_at: sql`now()`,
        }).where("id", "=", params.data.id)
          .returning(["id", "display_name", "avatar_url", "role", "status"])
          .executeTakeFirstOrThrow();
        await transaction.updateTable("sessions")
          .set({ revoked_at: sql`now()` })
          .where("user_id", "=", row.id)
          .where("revoked_at", "is", null)
          .execute();
        await transaction.insertInto("audit_logs").values({
          actor_user_id: request.auth!.userId,
          action: "member.updated",
          target_type: "user",
          target_id: row.id,
          metadata: body.data,
        }).execute();
        return row;
      });
      if (!member) {
        response.status(404).json({ error: "member_not_found" });
        return;
      }
      response.json({ member: memberJson(member) });
    } catch {
      next(new Error("member mutation failed"));
    }
  });

  return router;
}
