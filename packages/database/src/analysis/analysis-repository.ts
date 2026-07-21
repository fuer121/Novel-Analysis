import type { AnalysisMode, AnalysisPartStatus, AnalysisRunStatus, DatabaseExecutor } from "../db.js";
import type { ContentCipher, EncryptedContent } from "../library/content-encryption.js";
import { decryptJson, encryptJson } from "./content.js";

const JsonSchema = { parse(value: unknown) { return value; } };
export interface AnalysisActor { id: string; role: "admin" | "member" }
export interface CreateAnalysisTemplateInput { bookId: string; createdBy: string; name: string; prompt: string; outputSchema: unknown; contentHash: string; indexGroupId: string | null }
export interface UpdateAnalysisTemplateInput { templateId: string; actor: AnalysisActor; name: string; prompt: string; outputSchema: unknown; contentHash: string; indexGroupId: string | null }
export interface CreateAnalysisRunInput { bookId: string; createdBy: string; templateVersionId: string; jobId: string; mode: AnalysisMode; startChapter: number; endChapter: number; status: AnalysisRunStatus; executionSignature: string; totalParts: number }
export interface CreateAnalysisPartInput { runId: string; position: number; kind: string; status: AnalysisPartStatus; inputSignature: string }

const encrypted = (row: { result_ciphertext: Buffer | null; result_nonce: Buffer | null; result_tag: Buffer | null; result_key_version: string | null }): EncryptedContent | null => row.result_ciphertext === null ? null : ({ ciphertext: row.result_ciphertext, nonce: row.result_nonce!, tag: row.result_tag!, keyVersion: row.result_key_version! });

export function createAnalysisRepository(db: DatabaseExecutor, cipher: ContentCipher) {
  const inTransaction = <T>(operation: (executor: DatabaseExecutor) => Promise<T>) => db.isTransaction ? operation(db) : db.transaction().execute(operation);

  async function authorizeRun(executor: DatabaseExecutor, runId: string, actor: AnalysisActor) {
    if (actor.role === "admin") throw new Error("Analysis access denied");
    const run = await executor.selectFrom("analysis_runs").selectAll().where("id", "=", runId).where("created_by", "=", actor.id).executeTakeFirst();
    if (!run) throw new Error("Analysis access denied");
    return run;
  }

  return {
    async createTemplate(input: CreateAnalysisTemplateInput) {
      if (!input.name.trim() || !input.prompt.trim()) throw new Error("Invalid analysis template");
      return inTransaction(async (executor) => {
        const prompt = cipher.encrypt(input.prompt);
        const schema = encryptJson(cipher, input.outputSchema);
        const template = await executor.insertInto("analysis_templates").values({ book_id: input.bookId, created_by: input.createdBy, name: input.name, index_group_id: input.indexGroupId, current_version_id: null }).returningAll().executeTakeFirstOrThrow();
        const version = await executor.insertInto("analysis_template_versions").values({ template_id: template.id, version: 1, prompt_ciphertext: prompt.ciphertext, prompt_nonce: prompt.nonce, prompt_tag: prompt.tag, prompt_key_version: prompt.keyVersion, schema_ciphertext: schema.ciphertext, schema_nonce: schema.nonce, schema_tag: schema.tag, schema_key_version: schema.keyVersion, content_hash: input.contentHash }).returningAll().executeTakeFirstOrThrow();
        await executor.updateTable("analysis_templates").set({ current_version_id: version.id }).where("id", "=", template.id).execute();
        return { id: template.id, bookId: template.book_id, name: template.name, currentVersionId: version.id, indexGroupId: template.index_group_id, createdAt: template.created_at, updatedAt: template.updated_at };
      });
    },
    async listTemplates(input: { bookId: string; actor: AnalysisActor }) {
      if (input.actor.role === "admin") return [];
      return (await db.selectFrom("analysis_templates").selectAll().where("book_id", "=", input.bookId).where("created_by", "=", input.actor.id).orderBy("updated_at", "desc").execute()).map((row) => ({ id: row.id, bookId: row.book_id, name: row.name, currentVersionId: row.current_version_id!, indexGroupId: row.index_group_id, createdAt: row.created_at, updatedAt: row.updated_at }));
    },
    async updateTemplate(input: UpdateAnalysisTemplateInput) {
      if (input.actor.role === "admin" || !input.name.trim() || !input.prompt.trim()) throw new Error("Analysis access denied");
      return inTransaction(async (executor) => {
        const template = await executor.selectFrom("analysis_templates").selectAll().where("id", "=", input.templateId).where("created_by", "=", input.actor.id).executeTakeFirst();
        if (!template) throw new Error("Analysis access denied");
        const latest = await executor.selectFrom("analysis_template_versions").select("version").where("template_id", "=", template.id).orderBy("version", "desc").executeTakeFirstOrThrow();
        const prompt = cipher.encrypt(input.prompt);
        const schema = encryptJson(cipher, input.outputSchema);
        const version = await executor.insertInto("analysis_template_versions").values({ template_id: template.id, version: latest.version + 1, prompt_ciphertext: prompt.ciphertext, prompt_nonce: prompt.nonce, prompt_tag: prompt.tag, prompt_key_version: prompt.keyVersion, schema_ciphertext: schema.ciphertext, schema_nonce: schema.nonce, schema_tag: schema.tag, schema_key_version: schema.keyVersion, content_hash: input.contentHash }).returning("id").executeTakeFirstOrThrow();
        await executor.updateTable("analysis_templates").set({ name: input.name, index_group_id: input.indexGroupId, current_version_id: version.id, updated_at: new Date() }).where("id", "=", template.id).execute();
        return { id: template.id, currentVersionId: version.id };
      });
    },
    async getTemplate(input: { templateId: string; actor: AnalysisActor }) {
      if (input.actor.role === "admin") throw new Error("Analysis access denied");
      const row = await db.selectFrom("analysis_templates as t").innerJoin("analysis_template_versions as v", "v.id", "t.current_version_id").selectAll("t").select(["v.prompt_ciphertext", "v.prompt_nonce", "v.prompt_tag", "v.prompt_key_version", "v.schema_ciphertext", "v.schema_nonce", "v.schema_tag", "v.schema_key_version"]).where("t.id", "=", input.templateId).where("t.created_by", "=", input.actor.id).executeTakeFirst();
      if (!row) throw new Error("Analysis access denied");
      return { id: row.id, bookId: row.book_id, name: row.name, currentVersionId: row.current_version_id!, indexGroupId: row.index_group_id, prompt: cipher.decrypt({ ciphertext: row.prompt_ciphertext, nonce: row.prompt_nonce, tag: row.prompt_tag, keyVersion: row.prompt_key_version }), outputSchema: decryptJson(cipher, { ciphertext: row.schema_ciphertext, nonce: row.schema_nonce, tag: row.schema_tag, keyVersion: row.schema_key_version }, JsonSchema), createdAt: row.created_at, updatedAt: row.updated_at };
    },
    async createRun(input: CreateAnalysisRunInput) {
      const ownership = await db.selectFrom("analysis_template_versions as v").innerJoin("analysis_templates as t", "t.id", "v.template_id").select(["t.book_id", "t.created_by"]).where("v.id", "=", input.templateVersionId).executeTakeFirst();
      const job = await db.selectFrom("jobs").select("requested_by").where("id", "=", input.jobId).executeTakeFirst();
      if (!ownership || !job || ownership.book_id !== input.bookId || ownership.created_by !== input.createdBy || job.requested_by !== input.createdBy) throw new Error("Invalid analysis run");
      return db.insertInto("analysis_runs").values({ book_id: input.bookId, created_by: input.createdBy, template_version_id: input.templateVersionId, job_id: input.jobId, mode: input.mode, start_chapter: input.startChapter, end_chapter: input.endChapter, status: input.status, execution_signature: input.executionSignature, total_parts: input.totalParts, diagnostics: {} }).returningAll().executeTakeFirstOrThrow();
    },
    async createPart(input: CreateAnalysisPartInput) {
      return db.insertInto("analysis_parts").values({ run_id: input.runId, position: input.position, kind: input.kind, status: input.status, input_signature: input.inputSignature, result_ciphertext: null, result_nonce: null, result_tag: null, result_key_version: null, error_code: null, output_ref: null }).returningAll().executeTakeFirstOrThrow();
    },
    async completePart(input: { partId: string; actor: AnalysisActor; result: unknown }) {
      return inTransaction(async (executor) => {
        const reference = await executor.selectFrom("analysis_parts").select("run_id").where("id", "=", input.partId).executeTakeFirst();
        if (!reference) throw new Error("Analysis access denied");
        await authorizeRun(executor, reference.run_id, input.actor);
        const result = encryptJson(cipher, input.result);
        return executor.updateTable("analysis_parts").set({ status: "completed", result_ciphertext: result.ciphertext, result_nonce: result.nonce, result_tag: result.tag, result_key_version: result.keyVersion, updated_at: new Date() }).where("id", "=", input.partId).where("status", "in", ["queued", "running"]).returningAll().executeTakeFirstOrThrow();
      });
    },
    async completeRun(input: { runId: string; actor: AnalysisActor; result: unknown }) {
      return inTransaction(async (executor) => {
        await authorizeRun(executor, input.runId, input.actor);
        const result = encryptJson(cipher, input.result);
        return executor.updateTable("analysis_runs").set({ status: "completed", result_ciphertext: result.ciphertext, result_nonce: result.nonce, result_tag: result.tag, result_key_version: result.keyVersion, updated_at: new Date() }).where("id", "=", input.runId).returningAll().executeTakeFirstOrThrow();
      });
    },
    async getRunResult(input: { runId: string; actor: AnalysisActor }) {
      const row = await authorizeRun(db, input.runId, input.actor);
      const result = encrypted(row);
      return result ? decryptJson(cipher, result, JsonSchema) : null;
    },
    async findReusablePart(input: { runId: string; position: number; kind: string; inputSignature: string; actor: AnalysisActor }) {
      await authorizeRun(db, input.runId, input.actor);
      const row = await db.selectFrom("analysis_parts").selectAll().where("run_id", "=", input.runId).where("position", "=", input.position).where("kind", "=", input.kind).where("input_signature", "=", input.inputSignature).where("status", "=", "completed").executeTakeFirst();
      if (!row) return null;
      return { id: row.id, runId: row.run_id, position: row.position, kind: row.kind, status: row.status, inputSignature: row.input_signature, result: decryptJson(cipher, encrypted(row)!, JsonSchema) };
    },
  };
}
