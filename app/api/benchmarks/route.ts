import { runBenchmark } from "@/lib/benchmark";
import { recentRuns, saveRun } from "@/db/runs";

export async function GET() {
  try { return Response.json({ runs: await recentRuns() }); }
  catch { return Response.json({ error: "Could not load saved runs." }, { status: 503 }); }
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Send valid JSON." }, { status: 400 }); }
  if (!body || typeof body !== "object") return Response.json({ error: "Missing test settings." }, { status: 400 });
  const input = body as Record<string, unknown>;
  const count = Number(input.count);
  const horizon = Number(input.horizon);
  const margin = Number(input.margin);
  const seed = Number(input.seed);
  if (![count, horizon, margin, seed].every(Number.isFinite) || !Number.isInteger(count) || count < 10 || count > 500 || horizon < 0.5 || horizon > 8 || margin < 0 || margin > 60 || !Number.isInteger(seed) || seed < 0 || seed > 2147483647) {
    return Response.json({ error: "Use 10–500 tests, a 0.5–8 s horizon, a 0–60 unit margin, and a nonnegative integer seed." }, { status: 400 });
  }
  const result = runBenchmark({ count, horizon, margin, seed });
  try { const id = await saveRun(result); return Response.json({ id, result }, { status: 201 }); }
  catch { return Response.json({ result, saved: false, error: "Tests completed, but history could not be saved." }, { status: 200 }); }
}
