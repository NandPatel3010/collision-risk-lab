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

export const cameraRuns = sqliteTable("camera_runs", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  objectLabel: text("object_label").notNull(),
  status: text("status").notNull().default("active"),
  referenceElapsedMs: integer("reference_elapsed_ms"),
  calibrationRatio: real("calibration_ratio"),
}, (table) => [index("idx_camera_runs_created_at").on(table.createdAt)]);

export const cameraSamples = sqliteTable("camera_samples", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: text("run_id").notNull().references(() => cameraRuns.id),
  elapsedMs: integer("elapsed_ms").notNull(),
  scale: real("scale").notNull(),
  rawTtc: real("raw_ttc"),
  quality: real("quality").notNull(),
}, (table) => [index("idx_camera_samples_run_elapsed").on(table.runId, table.elapsedMs)]);
