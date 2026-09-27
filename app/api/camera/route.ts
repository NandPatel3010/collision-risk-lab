import { databaseRequest } from "@/db";
import { combinedCalibration, trialCalibration } from "@/lib/calibration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingSample = {
  elapsedMs: number;
  scale: number;
  rawTtc: number | null;
  quality: number;
};

type CameraRun = { id: string; status: string };
type CalibrationRow = { calibration_ratio: number | null };
type SavedSample = { elapsed_ms: number; raw_ttc: number | null; quality: number };

const bad = (message: string) => Response.json({ error: message }, { status: 400 });
const cleanId = (value: unknown): value is string =>
  typeof value === "string" && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
const cleanElapsed = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 3_600_000;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

async function calibration() {
  const rows = await databaseRequest<CalibrationRow[]>("camera_runs", {
    method: "GET",
    query: {
      select: "calibration_ratio",
      status: "eq.verified",
      order: "created_at.desc",
      limit: "25",
    },
  });
  const ratios = rows
    .map((row) => row.calibration_ratio)
    .filter((ratio): ratio is number => ratio !== null && Number.isFinite(ratio));
  return { factor: combinedCalibration(ratios), verifiedRuns: ratios.length };
}

export async function GET() {
  try {
    return Response.json(await calibration());
  } catch {
    return Response.json({ error: "Could not load saved calibration." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 64_000) {
    return bad("Request is too large.");
  }

  let data: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return bad("Invalid request.");
    data = parsed as Record<string, unknown>;
  } catch {
    return bad("Invalid request.");
  }

  try {
    if (data.action === "start") {
      const label = typeof data.label === "string" ? data.label.trim().slice(0, 80) : "";
      if (!label) return bad("An object label is required.");
      const id = crypto.randomUUID();
      await databaseRequest<null>("camera_runs", {
        method: "POST",
        body: { id, object_label: label },
      });
      return Response.json({ id, ...(await calibration()) }, { status: 201 });
    }

    if (!cleanId(data.id)) return bad("Invalid run ID.");
    const id = data.id;
    const [run] = await databaseRequest<CameraRun[]>("camera_runs", {
      method: "GET",
      query: { select: "id,status", id: `eq.${id}`, limit: "1" },
    });
    if (!run) return Response.json({ error: "Run not found." }, { status: 404 });

    if (data.action === "samples") {
      if (run.status !== "active") return bad("This run has ended.");
      if (!Array.isArray(data.samples) || data.samples.length > 32) return bad("Invalid sample batch.");

      const samples: IncomingSample[] = [];
      for (const value of data.samples as unknown[]) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return bad("Invalid measurement.");
        const sample = value as Record<string, unknown>;
        if (
          !cleanElapsed(sample.elapsedMs) ||
          !finite(sample.scale) || sample.scale <= 0 || sample.scale > 1 ||
          !(sample.rawTtc === null || (finite(sample.rawTtc) && sample.rawTtc >= 0 && sample.rawTtc <= 30)) ||
          !finite(sample.quality) || sample.quality < 0 || sample.quality > 1
        ) return bad("Invalid measurement.");
        samples.push({
          elapsedMs: sample.elapsedMs,
          scale: sample.scale,
          rawTtc: sample.rawTtc,
          quality: sample.quality,
        });
      }

      if (samples.length) {
        await databaseRequest<null>("camera_samples", {
          method: "POST",
          body: samples.map((sample) => ({
            run_id: id,
            elapsed_ms: sample.elapsedMs,
            scale: sample.scale,
            raw_ttc: sample.rawTtc,
            quality: sample.quality,
          })),
        });
      }
      return Response.json({ saved: samples.length });
    }

    if (data.action === "stop") {
      if (run.status === "active") {
        await databaseRequest<null>("camera_runs", {
          method: "PATCH",
          query: { id: `eq.${id}`, status: "eq.active" },
          body: { status: "stopped" },
        });
      }
      return Response.json({ stopped: true });
    }

    if (data.action === "finish") {
      if (run.status !== "active" || !cleanElapsed(data.referenceElapsedMs)) {
        return bad("Invalid reference point.");
      }
      const rows = await databaseRequest<SavedSample[]>("camera_samples", {
        method: "GET",
        query: {
          select: "elapsed_ms,raw_ttc,quality",
          run_id: `eq.${id}`,
          order: "elapsed_ms.desc",
          limit: "50",
        },
      });
      const samples = rows.map((row) => ({
        elapsedMs: row.elapsed_ms,
        rawTtc: row.raw_ttc,
        quality: row.quality,
      }));
      const ratio = trialCalibration(samples, data.referenceElapsedMs);
      await databaseRequest<null>("camera_runs", {
        method: "PATCH",
        query: { id: `eq.${id}`, status: "eq.active" },
        body: {
          status: ratio === null ? "completed" : "verified",
          reference_elapsed_ms: data.referenceElapsedMs,
          calibration_ratio: ratio,
        },
      });
      return Response.json({ learned: ratio !== null, ...(await calibration()) });
    }

    return bad("Unknown action.");
  } catch {
    return Response.json({ error: "Could not save the measurement." }, { status: 500 });
  }
}
