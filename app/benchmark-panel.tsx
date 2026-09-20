"use client";

import { useCallback, useEffect, useState } from "react";
import type { BenchmarkOptions, BenchmarkResult } from "@/lib/benchmark";

type SavedRun = { id: string; createdAt: string; result: BenchmarkResult };
type BenchmarkResponse = { result?: BenchmarkResult; error?: string; saved?: boolean };

function percentage(value: number) { return (value * 100).toFixed(1) + "%"; }

export default function BenchmarkPanel() {
  const [count, setCount] = useState(200);
  const [horizon, setHorizon] = useState(4);
  const [margin, setMargin] = useState(8);
  const [seed, setSeed] = useState(2026);
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [runs, setRuns] = useState<SavedRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saveNote, setSaveNote] = useState("");

  useEffect(() => { fetch("/api/benchmarks").then((response) => response.ok ? response.json() : Promise.reject()).then((data) => setRuns((data as { runs?: SavedRun[] }).runs ?? [])).catch(() => {}); }, []);

  const performBenchmark = useCallback(async (options: BenchmarkOptions): Promise<BenchmarkResult> => {
    setLoading(true); setError(""); setSaveNote("");
    try {
      const response = await fetch("/api/benchmarks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(options) });
      const data = await response.json() as BenchmarkResponse;
      if (!response.ok || !data.result) throw new Error(data.error || "Could not run tests.");
      setResult(data.result);
      if (data.saved === false) setSaveNote(data.error || "Results were not saved.");
      else {
        const updated = await fetch("/api/benchmarks");
        if (updated.ok) setRuns(((await updated.json()) as { runs?: SavedRun[] }).runs ?? []);
      }
      return data.result as BenchmarkResult;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not run tests."); throw cause; }
    finally { setLoading(false); }
  }, []);

  const runSuite = () => { void performBenchmark({ count, horizon, margin, seed }).catch(() => {}); };

  useEffect(() => {
    type WebMcp = { registerTool: (tool: { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean }; execute: (input: unknown) => Promise<unknown> }, options: { signal: AbortSignal }) => void | Promise<void> };
    const context = (document as Document & { modelContext?: WebMcp }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: "run_collision_benchmark",
      title: "Run collision prediction benchmark",
      description: "Run repeatable server-side traffic simulations and display the results in the test dashboard.",
      inputSchema: { type: "object", properties: { count: { type: "integer", minimum: 10, maximum: 500 }, horizon: { type: "number", minimum: 0.5, maximum: 8 }, margin: { type: "number", minimum: 0, maximum: 60 }, seed: { type: "integer", minimum: 0, maximum: 2147483647 } }, required: ["count", "horizon", "margin", "seed"], additionalProperties: false },
      annotations: { readOnlyHint: false },
      async execute(input) {
        const values = input as BenchmarkOptions;
        if (!values || !Number.isInteger(values.count) || values.count < 10 || values.count > 500 || !Number.isFinite(values.horizon) || values.horizon < 0.5 || values.horizon > 8 || !Number.isFinite(values.margin) || values.margin < 0 || values.margin > 60 || !Number.isInteger(values.seed) || values.seed < 0 || values.seed > 2147483647) throw new Error("Invalid benchmark settings.");
        setCount(values.count); setHorizon(values.horizon); setMargin(values.margin); setSeed(values.seed);
        const output = await performBenchmark(values);
        return { count: output.count, detectionRate: output.detectionRate, falseAlarmRate: output.falseAlarmRate, meanLeadTime: output.meanLeadTime };
      },
    }, { signal: lifecycle.signal })).catch(() => {});
    return () => lifecycle.abort();
  }, [performBenchmark]);

  return <section className="benchmark-section" aria-label="Backend test suite">
    <div className="benchmark-header"><div><p className="eyebrow">Server-run benchmark</p><h2>Put the predictor under pressure.</h2><p>Generate repeatable traffic variations and compare warnings against what actually happens.</p></div><div className="server-badge"><span /> Backend test engine</div></div>
    <div className="benchmark-body">
      <div className="settings-grid">
        <label>Test runs<input type="number" min="10" max="500" step="10" value={count} onChange={(event) => setCount(Number(event.target.value))} /></label>
        <label>Look-ahead (s)<input type="number" min="0.5" max="8" step="0.5" value={horizon} onChange={(event) => setHorizon(Number(event.target.value))} /></label>
        <label>Safety margin<input type="number" min="0" max="60" step="1" value={margin} onChange={(event) => setMargin(Number(event.target.value))} /></label>
        <label>Random seed<input type="number" min="0" max="2147483647" step="1" value={seed} onChange={(event) => setSeed(Number(event.target.value))} /></label>
      </div>
      <button className="play-button run-suite" disabled={loading} onClick={runSuite}>{loading ? "Running tests…" : "Run test suite"}</button>
      {error && <p className="error-message" role="alert">{error}</p>}
      {saveNote && <p className="error-message" role="status">{saveNote}</p>}
      {result ? <div className="results">
        <div className="results-title"><strong>{result.count} scenarios tested</strong><span>Seed {result.seed} · {result.processingMs.toFixed(0)} ms compute time</span></div>
        <div className="results-grid">
          <div><span>Timely warnings</span><strong>{percentage(result.detectionRate)}</strong><small>{result.truePositive} caught ≥1 s early · {result.falseNegative} late/missed</small></div>
          <div><span>False-alarm rate</span><strong>{percentage(result.falseAlarmRate)}</strong><small>{result.falsePositive} warnings on safe runs</small></div>
          <div><span>Timely precision</span><strong>{percentage(result.precision)}</strong><small>Of all warnings, how many were timely</small></div>
          <div><span>Average warning lead</span><strong>{result.meanLeadTime === null ? "—" : result.meanLeadTime.toFixed(2) + " s"}</strong><small>Before a collision occurred</small></div>
        </div>
        <div className="outcome-bars"><div className="bar-label"><span>Run outcomes</span><span>{result.truePositive + result.falseNegative} collisions / {result.count}</span></div><div className="stacked-bar"><span style={{ width: (result.truePositive / result.count * 100) + "%", background: "#37d6c2" }} title="Collisions caught" /><span style={{ width: (result.falseNegative / result.count * 100) + "%", background: "#ff786e" }} title="Collisions missed" /><span style={{ width: (result.falsePositive / result.count * 100) + "%", background: "#ffb15a" }} title="False alarms" /><span style={{ width: (result.trueNegative / result.count * 100) + "%", background: "#42616a" }} title="Correctly clear" /></div><div className="bar-legend"><span><i style={{ background: "#37d6c2" }} />Caught</span><span><i style={{ background: "#ff786e" }} />Missed</span><span><i style={{ background: "#ffb15a" }} />False alarm</span><span><i style={{ background: "#42616a" }} />Correctly clear</span></div></div>
      </div> : <div className="empty-results">Run the suite to see detection rates, false alarms, and warning time.</div>}
      {runs.length > 0 && <div className="history"><div className="bar-label"><span>Saved runs</span><span>Latest {runs.length}</span></div><div className="history-list">{runs.map((run) => <button key={run.id} onClick={() => setResult(run.result)}><span>{run.result.count} tests <small>· seed {run.result.seed}</small></span><strong>{percentage(run.result.detectionRate)} detected</strong></button>)}</div></div>}
    </div>
  </section>;
}
