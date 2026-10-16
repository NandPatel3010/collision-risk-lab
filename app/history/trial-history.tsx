"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { analyzeCalibration } from "@/lib/calibration";
import { localTrials, rememberTrial, serverTrials, subscribeTrials } from "@/lib/trial-history";
import { referenceRemaining, trialCsv, trialMetrics, type TrialPage, type TrialRun, type TrialSample } from "@/lib/trial-metrics";

function PredictionChart({ samples, reference }: { samples: TrialSample[]; reference: number | null }) {
  const sorted = [...samples].sort((a, b) => a.elapsed_ms - b.elapsed_ms);
  if (!sorted.length) return <div className="chart-empty">No saved samples to plot.</div>;
  const first = sorted[0].elapsed_ms / 1000;
  const last = Math.max(first + 0.1, sorted.at(-1)!.elapsed_ms / 1000);
  const maximum = Math.max(1, ...sorted.map((sample) => Math.max(sample.raw_ttc ?? 0, referenceRemaining(sample, reference) ?? 0)));
  const x = (time: number) => 58 + (time / 1000 - first) / (last - first) * 690;
  const y = (seconds: number) => 244 - seconds / maximum * 208;
  const segments: string[] = [];
  let segment = "";
  for (const sample of sorted) {
    if (sample.raw_ttc === null) { if (segment) segments.push(segment); segment = ""; }
    else segment += `${x(sample.elapsed_ms)},${y(sample.raw_ttc)} `;
  }
  if (segment) segments.push(segment);
  const referencePoints = sorted.flatMap((sample) => {
    const remaining = referenceRemaining(sample, reference);
    return remaining === null ? [] : [`${x(sample.elapsed_ms)},${y(remaining)}`];
  }).join(" ");
  return <figure className="prediction-chart">
    <svg viewBox="0 0 780 300" role="img" aria-labelledby="chart-title chart-description">
      <title id="chart-title">Raw prediction compared with time until the marked reference</title>
      <desc id="chart-description">Horizontal axis: elapsed seconds since recording began. Vertical axis: seconds remaining. Blue is raw prediction. Orange is the user-marked reference. Gaps indicate missing predictions.</desc>
      {[0, 0.25, 0.5, 0.75, 1].map((fraction) => <g key={fraction}>
        <line x1="58" x2="748" y1={y(maximum * fraction)} y2={y(maximum * fraction)} stroke="#e1e7eb" />
        <text x="48" y={y(maximum * fraction) + 4} textAnchor="end">{(maximum * fraction).toFixed(1)}</text>
      </g>)}
      <line x1="58" x2="58" y1="36" y2="244" stroke="#9bacb7" />
      <line x1="58" x2="748" y1="244" y2="244" stroke="#9bacb7" />
      {segments.map((points, index) => <polyline key={index} points={points} fill="none" stroke="#175f9e" strokeWidth="3" strokeLinecap="round" />)}
      {sorted.filter((sample) => sample.raw_ttc !== null).map((sample) => <circle key={sample.id} cx={x(sample.elapsed_ms)} cy={y(sample.raw_ttc!)} r="2.5" fill="#175f9e" />)}
      {referencePoints && <polyline points={referencePoints} fill="none" stroke="#b76a12" strokeWidth="2.5" strokeDasharray="7 4" />}
      <text x="58" y="265">{first.toFixed(1)}</text><text x="748" y="265" textAnchor="end">{last.toFixed(1)}</text>
      <text x="403" y="291" textAnchor="middle">Elapsed time (seconds)</text>
      <text x="58" y="20">Seconds remaining</text>
    </svg>
    <figcaption><span className="legend-prediction">Raw prediction</span><span className="legend-reference">User-marked reference</span></figcaption>
  </figure>;
}

export default function TrialHistory() {
  const trials = useSyncExternalStore(subscribeTrials, localTrials, serverTrials);
  const [selected, setSelected] = useState<TrialRun | null>(null);
  const [samples, setSamples] = useState<TrialSample[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lookup, setLookup] = useState("");
  const requestRef = useRef(0);

  const loadTrial = async (id: string, offset = 0) => {
    const sequence = ++requestRef.current;
    setLoading(true); setError("");
    // Do not leave a previous trial's results visible under a new selection.
    if (!offset) { setSelected(null); setSamples([]); setHasMore(false); }
    try {
      const response = await fetch(`/api/trials/${encodeURIComponent(id)}?offset=${offset}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      const data = await response.json() as TrialPage & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not load trial.");
      if (sequence !== requestRef.current) return;
      setSelected(data.run);
      setSamples((previous) => offset ? [...previous, ...data.samples.filter((sample) => !previous.some((old) => old.id === sample.id))] : data.samples);
      setHasMore(data.hasMore); setNextOffset(data.nextOffset);
      rememberTrial({ id: data.run.id, label: data.run.object_label, createdAt: data.run.created_at });
      window.history.replaceState(null, "", `/history?trial=${data.run.id}`);
    } catch (cause) {
      if (sequence === requestRef.current) setError(cause instanceof Error ? cause.message : "Could not load trial.");
    } finally { if (sequence === requestRef.current) setLoading(false); }
  };

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("trial");
    // Schedule the initial request after mount; user selections call it directly.
    const timer = window.setTimeout(() => { if (id) void loadTrial(id); }, 0);
    return () => { window.clearTimeout(timer); };
  }, []);

  const openById = (event: FormEvent) => { event.preventDefault(); if (lookup.trim()) void loadTrial(lookup.trim()); };
  const metrics = selected ? trialMetrics(samples, selected.reference_elapsed_ms) : null;
  const analysis = selected?.reference_elapsed_ms != null
    ? analyzeCalibration([...samples].sort((a, b) => b.elapsed_ms - a.elapsed_ms || b.id - a.id).slice(0, 50)
      .map((sample) => ({ elapsedMs: sample.elapsed_ms, rawTtc: sample.raw_ttc, quality: sample.quality })), selected.reference_elapsed_ms)
    : null;

  const download = () => {
    if (!selected) return;
    const url = URL.createObjectURL(new Blob([trialCsv(selected, samples)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `trial-${selected.id}${hasMore ? "-partial" : ""}.csv`;
    link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <main className="history-app">
    <header className="app-header"><div><strong>Collision Risk Lab</strong><span>Measurement history</span></div><Link href="/">Back to camera</Link></header>
    <div className="history-content">
      <div className="history-heading"><div><p className="eyebrow">SAVED EXPERIMENTS</p><h1>Trial history</h1><p>See what was recorded and why a reference trial did or did not update calibration.</p></div></div>
      <div className="history-layout">
        <aside className="history-list">
          <h2>Trials from this browser</h2><p className="muted">The latest 100 trial links are remembered on this browser. Open a trial ID to view a shared result.</p>
          <form onSubmit={openById}><label htmlFor="trial-id">Open a trial ID</label><div className="lookup"><input id="trial-id" value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="Paste trial ID" required /><button className="control-button secondary" disabled={loading}>Open</button></div></form>
          {!trials.length && <p className="empty-history">No trials remembered yet. Start the camera and select an object to begin recording.</p>}
          <ul>{trials.map((trial) => <li key={trial.id}><button type="button" className={selected?.id === trial.id ? "trial-link selected" : "trial-link"} onClick={() => void loadTrial(trial.id)}><strong>{trial.label}</strong><time dateTime={trial.createdAt}>{new Date(trial.createdAt).toLocaleString()}</time><span>{trial.id.slice(0, 8)}</span></button></li>)}</ul>
        </aside>
        <section className="history-detail" aria-label="Trial results" aria-busy={loading}>
          {error && <p className="error-message" role="alert">{error}</p>}
          {loading && <p role="status">Loading saved measurements...</p>}
          {!selected && !loading && <div className="choose-trial"><h2>Inspect a recorded trial</h2><p>Select a trial to compare predictions with its marked reference and inspect calibration eligibility.</p><p>Video is never included in trial history.</p></div>}
          {selected && metrics && <>
            <div className="trial-heading"><div><p className="eyebrow">{selected.status.toUpperCase()}</p><h2>{selected.object_label} trial</h2><p className="muted">{new Date(selected.created_at).toLocaleString()}</p></div><div className="trial-actions"><button type="button" className="control-button secondary" disabled={loading} onClick={() => void loadTrial(selected.id)}>Refresh</button><button type="button" className="control-button primary" onClick={download}>Export {hasMore ? "loaded " : ""}CSV</button></div></div>
            <p className="trial-id">Trial ID: {selected.id}</p>
            {selected.status === "active" && <p className="notice">This trial is still marked active. Refresh after recording finishes; saved samples can change while it is active.</p>}
            {hasMore && <p className="notice">Showing {samples.length} loaded samples. The graph, error summary, and CSV cover only these samples. Load earlier samples below to expand them.</p>}
            <div className="metric-grid"><div><span>Saved samples loaded</span><strong>{metrics.total}</strong></div><div><span>With predictions</span><strong>{metrics.predictions}</strong></div><div><span>Mean absolute error</span><strong>{metrics.meanAbsoluteError === null ? "--" : `${metrics.meanAbsoluteError.toFixed(2)} s`}</strong></div></div>
            <PredictionChart samples={samples} reference={selected.reference_elapsed_ms} />
            <p className="muted">Error compares raw predictions with time remaining until the user-marked reference, using {metrics.compared} valid samples before that reference. This is not measured physical-collision accuracy, and excludes any shared display correction.</p>
            <div className="calibration-report"><h3>Calibration report</h3><p>{analysis?.message ?? "No reference was marked. Samples can be saved without producing a calibration correction."}</p>
              {analysis && <><p>Eligibility uses the latest 50 saved samples, matching the finish API. Rejection counts use the first failing check for each sample.</p><dl><div><dt>Eligible / examined</dt><dd>{analysis.eligible} / {analysis.total}</dd></div><div><dt>No valid prediction</dt><dd>{analysis.rejected.noPrediction}</dd></div><div><dt>Below 65% quality</dt><dd>{analysis.rejected.lowQuality}</dd></div><div><dt>Outside reference window</dt><dd>{analysis.rejected.outsideWindow}</dd></div><div><dt>Outside correction range</dt><dd>{analysis.rejected.outsideRatio}</dd></div><div><dt>Saved trial correction</dt><dd>{selected.calibration_ratio?.toFixed(3) ?? "None"}</dd></div></dl></>}
            </div>
            {hasMore && <button type="button" className="control-button secondary" disabled={loading} onClick={() => void loadTrial(selected.id, nextOffset)}>Load earlier samples</button>}
          </>}
        </section>
      </div>
    </div>
  </main>;
}
