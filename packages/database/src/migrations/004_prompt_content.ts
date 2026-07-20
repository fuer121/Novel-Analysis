import type { Migration } from "kysely/migration";

export const promptContentMigration: Migration = {
  async up(db) {
    await db.schema.alterTable("prompt_versions")
      .addColumn("content", "text", (column) => column.notNull().defaultTo(""))
      .execute();
  },
  async down(db) {
    await db.schema.alterTable("prompt_versions").dropColumn("content").execute();
  },
};
