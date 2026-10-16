import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const moduleAt = (file) => import(pathToFileURL(path.join(process.env.COLLISION_TEST_BUILD, file)).href);
const { analyzeCalibration, trialCalibration, combinedCalibration } = await moduleAt("lib/calibration.js");
const { SampleBuffer } = await moduleAt("lib/sample-buffer.js");
const { trialMetrics, trialCsv } = await moduleAt("lib/trial-metrics.js");
const { POST, GET } = await moduleAt("app/api/camera/route.js");
const { GET: getTrial } = await moduleAt("app/api/trials/[id]/route.js");
const { databaseRequest, DatabaseError } = await moduleAt("db/index.js");

const runId = "12345678-1234-4234-8234-123456789abc";
const sample = (index, overrides = {}) => ({ clientSampleId: `12345678-1234-4234-8234-${String(index).padStart(12, "0")}`,
  elapsedMs: index * 200, scale: 0.2, rawTtc: 4, quality: 0.9, ...overrides });
const post = (body) => POST(new Request("http://localhost/api/camera", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

test("calibration explains mutually exclusive rejection reasons without lowering thresholds", () => {
  const analysis = analyzeCalibration([
    { elapsedMs: 1000, rawTtc: null, quality: 1 },
    { elapsedMs: 1000, rawTtc: 3, quality: 0.5 },
    { elapsedMs: 4900, rawTtc: 3, quality: 1 },
    { elapsedMs: 1000, rawTtc: 0.1, quality: 1 },
    { elapsedMs: 1000, rawTtc: 4, quality: 1 },
  ], 5000);
  assert.deepEqual(analysis.rejected, { noPrediction: 1, lowQuality: 1, outsideWindow: 1, outsideRatio: 1 });
  assert.equal(analysis.eligible, 1);
  assert.equal(analysis.ratio, null);
  assert.match(analysis.message, /at least 3 required/);
});

test("one trial with three eligible samples can update calibration", () => {
  assert.equal(trialCalibration([1000, 2000, 3000].map((elapsedMs) => ({ elapsedMs, rawTtc: (5000 - elapsedMs) / 750, quality: 0.9 })), 5000), 0.75);
  assert.equal(combinedCalibration([]), 1);
  assert.equal(combinedCalibration([0.6, 1]), 0.8);
  assert.equal(combinedCalibration([2.4]), 1.8);
  assert.equal(combinedCalibration([0.35]), 0.5);
});

test("calibration handles empty and invalid measurements", () => {
  assert.match(analyzeCalibration([], 5000).message, /No measurements/);
  assert.equal(trialCalibration([{ elapsedMs: NaN, rawTtc: 1, quality: 1 }], 5000), null);
  assert.equal(trialCalibration([{ elapsedMs: 1000, rawTtc: 1, quality: NaN }], 5000), null);
});

test("error metrics use raw predictions before the reference and preserve missing values in CSV", () => {
  const samples = [
    { id: 1, elapsed_ms: 1000, raw_ttc: 4, quality: 0.8, scale: 0.2 },
    { id: 2, elapsed_ms: 2000, raw_ttc: 2.5, quality: 0.8, scale: 0.3 },
    { id: 3, elapsed_ms: 3000, raw_ttc: null, quality: 0.1, scale: 0.4 },
    { id: 4, elapsed_ms: 4500, raw_ttc: 1, quality: 0.9, scale: 0.5 },
  ];
  const metrics = trialMetrics(samples, 4000);
  assert.equal(metrics.meanAbsoluteError, 0.75);
  assert.equal(metrics.compared, 2);
  assert.equal(trialMetrics(samples, null).meanAbsoluteError, null);
  const csv = trialCsv({ id: runId, reference_elapsed_ms: 4000 }, samples);
  assert.match(csv, /3000,0.4,,0.1,1,/);
  assert.match(csv, /4500,0.5,1,0.9,,/);
});

test("failed uploads retain stable IDs; successful batches are not repeated", async () => {
  const buffer = new SampleBuffer();
  for (let index = 0; index < 70; index++) buffer.add(sample(index));
  let attempts = 0;
  await assert.rejects(buffer.flush(async (batch) => {
    attempts++;
    assert.equal(batch.length, 32);
    if (attempts === 2) throw new Error("network interrupted");
  }), /network interrupted/);
  assert.equal(buffer.savedCount, 32);
  assert.equal(buffer.pendingCount, 38);
  const retried = [];
  await buffer.flush(async (batch) => { retried.push(...batch.map((row) => row.clientSampleId)); });
  assert.equal(retried[0], sample(32).clientSampleId);
  assert.equal(retried.length, 38);
  assert.equal(buffer.savedCount, 70);
  assert.equal(buffer.pendingCount, 0);
});

test("concurrent flushes share one upload and additions during upload are drained", async () => {
  const buffer = new SampleBuffer(); buffer.add(sample(1));
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const batches = [];
  const send = async (batch) => { batches.push(batch); if (batches.length === 1) await wait; };
  const first = buffer.flush(send); const second = buffer.flush(send);
  assert.equal(first, second);
  buffer.add(sample(2)); release();
  await first;
  assert.equal(batches.length, 2);
  assert.equal(buffer.savedCount, 2);
});

// In-memory PostgREST substitute: exercises the real route and request helper,
// while avoiding credentials or writes to anyone's live Supabase database.
function fakeDatabase(t) {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = "https://database.invalid";
  process.env.SUPABASE_SECRET_KEY = "test-only";
  const state = { runs: [], samples: [], calibrationReadFails: false, sampleWritesFail: false, loseNextSampleResponse: false };
  t.after(() => { globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previousKey; });
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    assert.equal(options.headers.apikey, "test-only");
    assert.equal(url.origin, "https://database.invalid");
    const table = url.pathname.endsWith("camera_runs") ? "runs" : "samples";
    const query = url.searchParams;
    const matches = (row) => ["id", "run_id", "status"].every((key) => !query.has(key) || String(row[key]) === query.get(key).slice(3));
    if (options.method === "GET") {
      if (table === "runs" && query.get("status") === "eq.verified" && state.calibrationReadFails) return Response.json({ code: "test" }, { status: 503 });
      let rows = state[table].filter(matches);
      rows.sort((a, b) => table === "samples" ? b.elapsed_ms - a.elapsed_ms || b.id - a.id : String(b.created_at).localeCompare(String(a.created_at)));
      const offset = Number(query.get("offset") ?? 0);
      rows = rows.slice(offset, offset + Number(query.get("limit") ?? 1000));
      return Response.json(rows);
    }
    const body = JSON.parse(options.body);
    if (options.method === "PATCH") {
      state[table].filter(matches).forEach((row) => Object.assign(row, body));
    } else if (table === "runs") {
      state.runs.push({ ...body, created_at: new Date().toISOString(), status: "active", reference_elapsed_ms: null, calibration_ratio: null });
    } else {
      if (state.sampleWritesFail) return Response.json({ code: "test" }, { status: 503 });
      assert.equal(query.get("on_conflict"), "run_id,client_sample_id");
      assert.match(options.headers.Prefer, /resolution=ignore-duplicates/);
      for (const row of body) if (!row.client_sample_id || !state.samples.some((old) => old.run_id === row.run_id && old.client_sample_id === row.client_sample_id)) {
        state.samples.push({ ...row, id: state.samples.length + 1 });
      }
      if (state.loseNextSampleResponse) { state.loseNextSampleResponse = false; throw new Error("response lost after commit"); }
    }
    return new Response(null, { status: 204 });
  };
  return state;
}

test("route lifecycle: save, finish with diagnostics, retry finish, read paginated history", async (t) => {
  const db = fakeDatabase(t);
  const start = await post({ action: "start", label: "bottle" });
  assert.equal(start.status, 201);
  const { id } = await start.json();
  const save = await post({ action: "samples", id, samples: [sample(5), sample(10), sample(15)] });
  assert.equal(save.status, 200);
  const finish = await post({ action: "finish", id, referenceElapsedMs: 5000 });
  const result = await finish.json();
  assert.equal(result.learned, true);
  assert.equal(result.analysis.eligible, 3);
  assert.equal(db.runs[0].status, "verified");
  assert.equal((await post({ action: "finish", id, referenceElapsedMs: 5000 })).status, 200);
  assert.equal((await post({ action: "finish", id, referenceElapsedMs: 6000 })).status, 400);
  assert.equal((await post({ action: "samples", id, samples: [sample(20)] })).status, 400);
  const page = await getTrial(new Request(`http://localhost/api/trials/${id}?limit=2`), { params: Promise.resolve({ id }) });
  const data = await page.json();
  assert.equal(data.samples.length, 2); assert.equal(data.hasMore, true); assert.equal(data.nextOffset, 2);
  const next = await getTrial(new Request(`http://localhost/api/trials/${id}?limit=2&offset=2`), { params: Promise.resolve({ id }) });
  assert.equal((await next.json()).samples.length, 1);
});

test("a lost upload response can be retried without duplicate database samples", async (t) => {
  const db = fakeDatabase(t);
  const { id } = await (await post({ action: "start", label: "cup" })).json();
  const buffer = new SampleBuffer(); buffer.add(sample(1));
  const send = async (samples) => { const response = await post({ action: "samples", id, samples }); if (!response.ok) throw new Error("upload not acknowledged"); };
  db.loseNextSampleResponse = true;
  await assert.rejects(buffer.flush(send));
  assert.equal(db.samples.length, 1); assert.equal(buffer.pendingCount, 1);
  await buffer.flush(send);
  assert.equal(db.samples.length, 1); assert.equal(buffer.pendingCount, 0);
});

test("failed upload blocks finish in the client sequence and retains pending measurements", async (t) => {
  const db = fakeDatabase(t);
  const { id } = await (await post({ action: "start", label: "cup" })).json();
  const buffer = new SampleBuffer(); buffer.add(sample(1)); db.sampleWritesFail = true;
  await assert.rejects((async () => {
    await buffer.flush(async (samples) => { const response = await post({ action: "samples", id, samples }); if (!response.ok) throw new Error("upload failed"); });
    await post({ action: "finish", id, referenceElapsedMs: 5000 });
  })());
  assert.equal(db.runs[0].status, "active"); assert.equal(buffer.pendingCount, 1);
});

test("a calibration read failure does not hide a successfully created or finished run", async (t) => {
  const db = fakeDatabase(t); db.calibrationReadFails = true;
  const response = await post({ action: "start", label: "bottle" });
  const start = await response.json();
  assert.equal(response.status, 201); assert.ok(start.id); assert.equal(start.calibrationAvailable, false);
  const finish = await post({ action: "finish", id: start.id, referenceElapsedMs: 5000 });
  const result = await finish.json();
  assert.equal(finish.status, 200); assert.equal(result.learned, false); assert.match(result.analysis.message, /No measurements/);
  assert.equal(db.runs[0].status, "completed");
});

test("API rejects malformed IDs, excessive batches, and invalid measurements", async (t) => {
  fakeDatabase(t);
  assert.equal((await post({ action: "samples", id: "bad", samples: [] })).status, 400);
  const { id } = await (await post({ action: "start", label: "cup" })).json();
  assert.equal((await post({ action: "samples", id, samples: Array.from({ length: 33 }, (_, index) => sample(index)) })).status, 400);
  assert.equal((await post({ action: "samples", id, samples: [sample(1, { scale: 2 })] })).status, 400);
  assert.equal((await post({ action: "samples", id, samples: [sample(1, { clientSampleId: "bad" })] })).status, 400);
  assert.equal((await post({ action: "samples", id, samples: [sample(1, { rawTtc: null })] })).status, 200);
  assert.equal((await post({ action: "stop", id })).status, 200);
  assert.equal((await post({ action: "stop", id })).status, 200);
});

test("history validates pagination and distinguishes a missing run", async (t) => {
  fakeDatabase(t);
  assert.equal((await getTrial(new Request("http://localhost?limit=501"), { params: Promise.resolve({ id: runId }) })).status, 400);
  assert.equal((await getTrial(new Request("http://localhost?offset=-1"), { params: Promise.resolve({ id: runId }) })).status, 400);
  assert.equal((await getTrial(new Request("http://localhost"), { params: Promise.resolve({ id: runId }) })).status, 404);
});

test("missing server configuration returns a useful message without exposing secrets", async (t) => {
  fakeDatabase(t); delete process.env.SUPABASE_SECRET_KEY;
  const response = await GET();
  assert.equal(response.status, 503); assert.match((await response.json()).error, /not configured/);
  await assert.rejects(databaseRequest("camera_runs", { method: "GET" }), DatabaseError);
});

test("schema errors identify the migration requirement without forwarding database contents", async (t) => {
  fakeDatabase(t);
  globalThis.fetch = async () => Response.json({ code: "PGRST204", message: "sensitive details" }, { status: 400 });
  const response = await GET(); const body = await response.json();
  assert.equal(response.status, 503); assert.match(body.error, /migrations/); assert.doesNotMatch(body.error, /sensitive/);
});
