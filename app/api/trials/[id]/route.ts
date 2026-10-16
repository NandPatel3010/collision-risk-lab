import { databaseFailure, databaseRequest } from "@/db";
import type { TrialRun, TrialSample } from "@/lib/trial-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) {
    return Response.json({ error: "Invalid trial ID." }, { status: 400 });
  }
  const url = new URL(request.url);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? 500);
  if (!Number.isInteger(offset) || offset < 0 || offset > 100_000 || !Number.isInteger(limit) || limit < 1 || limit > 500) {
    return Response.json({ error: "Invalid page. Limit must be 1-500 and offset 0-100000." }, { status: 400 });
  }
  try {
    const [run] = await databaseRequest<TrialRun[]>("camera_runs", {
      method: "GET", query: { id: `eq.${id}`, select: "id,created_at,object_label,status,reference_elapsed_ms,calibration_ratio", limit: "1" },
    });
    if (!run) return Response.json({ error: "Trial not found." }, { status: 404 });
    const rows = await databaseRequest<TrialSample[]>("camera_samples", {
      method: "GET", query: { run_id: `eq.${id}`, select: "id,elapsed_ms,scale,raw_ttc,quality",
        order: "elapsed_ms.desc,id.desc", offset: String(offset), limit: String(limit + 1) },
    });
    return Response.json({ run, samples: rows.slice(0, limit), hasMore: rows.length > limit, nextOffset: offset + Math.min(limit, rows.length) },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return databaseFailure(error); }
}
