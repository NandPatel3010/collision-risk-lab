import { env } from "cloudflare:workers";
import type { BenchmarkResult } from "../lib/benchmark";

function database() {
  if (!env.DB) throw new Error("Benchmark history is unavailable.");
  return env.DB;
}

export async function saveRun(result: BenchmarkResult) {
  const id = crypto.randomUUID();
  await database().prepare(
    "INSERT INTO benchmark_runs (id, count, horizon, margin, seed, result_json) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, result.count, result.horizon, result.margin, result.seed, JSON.stringify(result)).run();
  return id;
}

export async function recentRuns(): Promise<Array<{ id: string; createdAt: string; result: BenchmarkResult }>> {
  const rows = await database().prepare(
    "SELECT id, created_at, result_json FROM benchmark_runs ORDER BY created_at DESC, id DESC LIMIT 8"
  ).all<{ id: string; created_at: string; result_json: string }>();
  return (rows.results ?? []).map((row) => ({ id: row.id, createdAt: row.created_at, result: JSON.parse(row.result_json) as BenchmarkResult }));
}
