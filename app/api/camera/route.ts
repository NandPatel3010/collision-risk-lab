import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { cameraRuns, cameraSamples } from "@/db/schema";
import { combinedCalibration, trialCalibration } from "@/lib/calibration";

export const runtime = "edge";

type IncomingSample = { elapsedMs: number; scale: number; rawTtc: number | null; quality: number };
const bad = (message: string) => Response.json({ error: message }, { status: 400 });
const cleanId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
const cleanElapsed = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 3_600_000;

async function calibration(db: ReturnType<typeof getDb>) {
  const rows = await db.select({ calibrationRatio: cameraRuns.calibrationRatio }).from(cameraRuns)
    .where(eq(cameraRuns.status, "verified")).orderBy(desc(cameraRuns.createdAt)).limit(25);
  const ratios = rows.map((row) => row.calibrationRatio).filter((ratio): ratio is number => ratio !== null);
  return { factor: combinedCalibration(ratios), verifiedRuns: ratios.length };
}

export async function GET() {
  try { return Response.json(await calibration(getDb())); }
  catch { return Response.json({ error: "Could not load saved calibration." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const data = await request.json() as Record<string, unknown>;
    const db = getDb();
    if (data.action === "start") {
      const label = typeof data.label === "string" ? data.label.trim().slice(0, 80) : "";
      if (!label) return bad("An object label is required.");
      const id = crypto.randomUUID();
      await db.insert(cameraRuns).values({ id, objectLabel: label });
      return Response.json({ id, ...(await calibration(db)) }, { status: 201 });
    }
    if (!cleanId(data.id)) return bad("Invalid run ID.");
    const id = data.id;
    const [run] = await db.select().from(cameraRuns).where(eq(cameraRuns.id, id)).limit(1);
    if (!run) return Response.json({ error: "Run not found." }, { status: 404 });
    if (data.action === "samples") {
      if (run.status !== "active") return bad("This run has ended.");
      if (!Array.isArray(data.samples) || data.samples.length > 32) return bad("Invalid sample batch.");
      const samples = data.samples as IncomingSample[];
      if (!samples.every((sample) => sample && cleanElapsed(sample.elapsedMs) && Number.isFinite(sample.scale) && sample.scale > 0 && sample.scale <= 1 && (sample.rawTtc === null || Number.isFinite(sample.rawTtc) && sample.rawTtc >= 0 && sample.rawTtc <= 30) && Number.isFinite(sample.quality) && sample.quality >= 0 && sample.quality <= 1)) return bad("Invalid measurement.");
      if (samples.length) await db.insert(cameraSamples).values(samples.map((sample) => ({ ...sample, runId: id })));
      return Response.json({ saved: samples.length });
    }
    if (data.action === "stop") {
      if (run.status === "active") await db.update(cameraRuns).set({ status: "stopped" }).where(and(eq(cameraRuns.id, id), eq(cameraRuns.status, "active")));
      return Response.json({ stopped: true });
    }
    if (data.action === "finish") {
      if (run.status !== "active" || !cleanElapsed(data.referenceElapsedMs)) return bad("Invalid reference point.");
      const rows = await db.select({ elapsedMs: cameraSamples.elapsedMs, rawTtc: cameraSamples.rawTtc, quality: cameraSamples.quality })
        .from(cameraSamples).where(eq(cameraSamples.runId, id)).orderBy(desc(cameraSamples.elapsedMs)).limit(50);
      const ratio = trialCalibration(rows, data.referenceElapsedMs);
      await db.update(cameraRuns).set({ status: ratio === null ? "completed" : "verified", referenceElapsedMs: data.referenceElapsedMs, calibrationRatio: ratio }).where(and(eq(cameraRuns.id, id), eq(cameraRuns.status, "active")));
      return Response.json({ learned: ratio !== null, ...(await calibration(db)) });
    }
    return bad("Unknown action.");
  } catch {
    return Response.json({ error: "Could not save the measurement." }, { status: 500 });
  }
}
