import { sql } from "kysely";
import type { Migration } from "kysely/migration";

export const indexGroupCategoryScopeMigration: Migration = {
  async up(db) {
    await db.schema.alterTable("index_groups")
      .addColumn("category_scope", "text", (column) => column.notNull().defaultTo("general"))
      .execute();
    await sql`alter table index_groups add constraint index_groups_category_scope_check check (category_scope in ('general', 'magical_creature'))`.execute(db);
  },
  async down(db) {
    await db.schema.alterTable("index_groups").dropColumn("category_scope").execute();
  },
};
