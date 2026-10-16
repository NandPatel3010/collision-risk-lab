import { databaseFailure, databaseRequest } from "@/db";
import { analyzeCalibration, combinedCalibration } from "@/lib/calibration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingSample = {
  elapsedMs: number;
  scale: number;
  rawTtc: number | null;
  quality: number;
  clientSampleId?: string;
};

type CameraRun = { id: string; status: string; reference_elapsed_ms: number | null; calibration_ratio: number | null };
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

// Saving a run must not appear to fail merely because the following read fails.
async function optionalCalibration() {
  try { return { ...(await calibration()), calibrationAvailable: true }; }
  catch { return { calibrationAvailable: false }; }
}

async function runAnalysis(id: string, referenceElapsedMs: number) {
  const rows = await databaseRequest<SavedSample[]>("camera_samples", {
    method: "GET", query: { select: "elapsed_ms,raw_ttc,quality", run_id: `eq.${id}`, order: "elapsed_ms.desc,id.desc", limit: "50" },
  });
  return analyzeCalibration(rows.map((row) => ({ elapsedMs: row.elapsed_ms, rawTtc: row.raw_ttc, quality: row.quality })), referenceElapsedMs);
}

export async function GET() {
  try {
    return Response.json(await calibration());
  } catch (error) {
    return databaseFailure(error);
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
      return Response.json({ id, ...(await optionalCalibration()) }, { status: 201 });
    }

    if (!cleanId(data.id)) return bad("Invalid run ID.");
    const id = data.id;
    const [run] = await databaseRequest<CameraRun[]>("camera_runs", {
      method: "GET",
      query: { select: "id,status,reference_elapsed_ms,calibration_ratio", id: `eq.${id}`, limit: "1" },
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
          !finite(sample.quality) || sample.quality < 0 || sample.quality > 1 ||
          !(sample.clientSampleId === undefined || cleanId(sample.clientSampleId))
        ) return bad("Invalid measurement.");
        samples.push({
          elapsedMs: sample.elapsedMs,
          scale: sample.scale,
          rawTtc: sample.rawTtc,
          quality: sample.quality,
          ...(sample.clientSampleId === undefined ? {} : { clientSampleId: sample.clientSampleId }),
        });
      }

      if (samples.length) {
        await databaseRequest<null>("camera_samples", {
          method: "POST",
          query: { on_conflict: "run_id,client_sample_id" },
          ignoreDuplicates: true,
          body: samples.map((sample) => ({
            run_id: id,
            elapsed_ms: sample.elapsedMs,
            scale: sample.scale,
            raw_ttc: sample.rawTtc,
            quality: sample.quality,
            client_sample_id: sample.clientSampleId ?? null,
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
      if (!cleanElapsed(data.referenceElapsedMs)) {
        return bad("Invalid reference point.");
      }
      const alreadyFinished = (run.status === "completed" || run.status === "verified") && run.reference_elapsed_ms === data.referenceElapsedMs;
      if (run.status !== "active" && !alreadyFinished) return bad("This run has ended or uses a different reference point.");
      const analysis = await runAnalysis(id, data.referenceElapsedMs);
      if (alreadyFinished) {
        return Response.json({ learned: run.calibration_ratio !== null, analysis, ...(await optionalCalibration()) });
      }
      const ratio = analysis.ratio;
      await databaseRequest<null>("camera_runs", {
        method: "PATCH",
        query: { id: `eq.${id}`, status: "eq.active" },
        body: {
          status: ratio === null ? "completed" : "verified",
          reference_elapsed_ms: data.referenceElapsedMs,
          calibration_ratio: ratio,
        },
      });
      return Response.json({ learned: ratio !== null, analysis, ...(await optionalCalibration()) });
    }

    return bad("Unknown action.");
  } catch (error) {
    return databaseFailure(error);
  }
}
