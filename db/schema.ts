import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

export const benchmarkRuns = sqliteTable("benchmark_runs", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  count: integer("count").notNull(),
  horizon: real("horizon").notNull(),
  margin: real("margin").notNull(),
  seed: integer("seed").notNull(),
  resultJson: text("result_json").notNull(),
}, (table) => [index("idx_benchmark_runs_created_at").on(table.createdAt)]);
