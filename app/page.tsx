"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isCollision, positionsAt, predict, SCENARIOS, type ScenarioId } from "@/lib/simulation";
import BenchmarkPanel from "./benchmark-panel";

export default function Home() {
  const [scenarioId, setScenarioId] = useState<ScenarioId>("crossing");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [horizon, setHorizon] = useState(4);
  const [margin, setMargin] = useState(8);
  const [speedScale, setSpeedScale] = useState(1);
  const lastFrame = useRef<number | null>(null);
  const scenario = useMemo(() => SCENARIOS.find((item) => item.id === scenarioId) ?? SCENARIOS[0], [scenarioId]);
  const liveScenario = useMemo(() => ({ ...scenario, vehicles: scenario.vehicles.map((vehicle) => vehicle.id === "A" ? { ...vehicle, vx: vehicle.vx * speedScale, vy: vehicle.vy * speedScale } : vehicle) }), [scenario, speedScale]);
  const vehicles = positionsAt(liveScenario, time);
  const prediction = predict(vehicles, horizon, margin);
  const collision = isCollision(vehicles);
  const riskSamples = useMemo(() => Array.from({ length: 61 }, (_, index) => {
    const seconds = scenario.duration * index / 60;
    const next = positionsAt(liveScenario, seconds);
    return { seconds, gap: predict(next, horizon, margin).gap, collision: isCollision(next) };
  }), [liveScenario, scenario.duration, horizon, margin]);
  const chartPath = riskSamples.map((sample, index) => {
    const x = index * 15;
    const y = 94 - Math.max(0, Math.min(86, (sample.gap + 10) * 0.55));
    return (index === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1);
  }).join(" ");
  const thresholdY = 94 - Math.max(0, Math.min(86, (margin + 10) * 0.55));

  useEffect(() => {
    if (!playing) { lastFrame.current = null; return; }
    let frame = 0;
    const tick = (now: number) => {
      if (lastFrame.current === null) lastFrame.current = now;
      const delta = Math.min((now - lastFrame.current) / 1000, 0.08);
      lastFrame.current = now;
      setTime((current) => Math.min(current + delta, scenario.duration));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, scenario.duration]);

  useEffect(() => { if (time >= scenario.duration) setPlaying(false); }, [time, scenario.duration]);

  const chooseScenario = (id: ScenarioId) => { setPlaying(false); setTime(0); setSpeedScale(1); setScenarioId(id); };
  const setBounded = (value: string, min: number, max: number, setter: (value: number) => void) => {
    const parsed = Number(value);
    if (value !== "" && Number.isFinite(parsed)) setter(Math.min(max, Math.max(min, parsed)));
  };

  return <main className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">◈</span><span>Collision Risk Lab</span></div><span className="topbar-note">2D prediction workspace</span></header>
    <div className="workspace">
      <section className="stage-column" aria-label="Collision simulation">
        <div className="section-heading"><div><p className="eyebrow">Live scenario</p><h1>{scenario.name}</h1><p className="description">{scenario.detail}</p></div><span className={"status-pill " + (collision ? "collision" : prediction.risk ? "warning" : "clear")}><span className="status-dot" />{collision ? "Collision" : prediction.risk ? "Risk detected" : "Clear"}</span></div>
        <div className="simulation-frame"><svg viewBox="0 0 900 500" role="img" aria-label="Top-down view of moving vehicles and predicted paths">
          <defs><pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="#1d3340" strokeWidth="1" /></pattern></defs>
          <rect width="900" height="500" fill="#0b1922" /><rect width="900" height="500" fill="url(#grid)" />
          <rect x="0" y="192" width="900" height="116" fill="#142833" /><line x1="0" y1="250" x2="900" y2="250" stroke="#607783" strokeWidth="2" strokeDasharray="18 19" opacity=".5" />
          {(scenarioId === "crossing" || scenarioId === "near-miss") && <><rect x="390" y="0" width="120" height="500" fill="#142833" /><line x1="450" y1="0" x2="450" y2="500" stroke="#607783" strokeWidth="2" strokeDasharray="18 19" opacity=".5" /></>}
          {vehicles.map((vehicle) => { const angle = Math.atan2(vehicle.vy, vehicle.vx) * 180 / Math.PI; return <g key={vehicle.id}>
            <line x1={vehicle.x} y1={vehicle.y} x2={vehicle.x + vehicle.vx * prediction.seconds} y2={vehicle.y + vehicle.vy * prediction.seconds} stroke={vehicle.color} strokeWidth="2" strokeDasharray="7 7" opacity=".7" />
            <g transform={"translate(" + vehicle.x + " " + vehicle.y + ") rotate(" + angle + ")"}><rect x="-22" y="-13" width="44" height="26" rx="7" fill={vehicle.color} /><rect x="3" y="-10" width="9" height="20" rx="2" fill="#0b1922" opacity=".52" /></g>
            <text x={vehicle.x} y={vehicle.y - 23} textAnchor="middle" fill="#d5e8e9" fontSize="14" fontWeight="700">{vehicle.id}</text>
          </g>; })}
          {prediction.risk && <g><circle cx={prediction.closestX} cy={prediction.closestY} r="28" fill="none" stroke="#ffb15a" strokeWidth="2" opacity=".9" /><circle cx={prediction.closestX} cy={prediction.closestY} r="43" fill="none" stroke="#ffb15a" strokeWidth="1" opacity=".4" /></g>}
        </svg><div className="frame-label">TOP-DOWN SIMULATION <span>·</span> {time.toFixed(1)}s / {scenario.duration}s</div></div>
        <div className="playback-bar"><button className="play-button" onClick={() => { if (time >= scenario.duration) setTime(0); setPlaying(!playing); }}>{playing ? "Pause simulation" : time >= scenario.duration ? "Replay simulation" : "Run simulation"}</button><button className="secondary-button" onClick={() => { setPlaying(false); setTime(0); }}>Reset</button><div className="timeline" aria-label="Simulation progress"><div style={{ width: (time / scenario.duration * 100) + "%" }} /></div></div>
        <div className="trace-card"><div className="trace-header"><div><p className="eyebrow">Prediction trace</p><strong>Closest projected gap over time</strong></div><div className="trace-legend"><span className="trace-line-key" />Projected gap <span className="trace-threshold-key" />Warning threshold</div></div><svg viewBox="0 0 900 120" role="img" aria-label="Chart of predicted vehicle separation through the scenario"><line x1="0" y1={thresholdY} x2="900" y2={thresholdY} stroke="#80623d" strokeDasharray="5 5" /><path d={chartPath} fill="none" stroke="#54ddca" strokeWidth="3" strokeLinejoin="round" /><line x1={time / scenario.duration * 900} y1="0" x2={time / scenario.duration * 900} y2="113" stroke="#f4faf9" opacity=".8" strokeWidth="1.5" /><circle cx={time / scenario.duration * 900} cy={94 - Math.max(0, Math.min(86, (prediction.gap + 10) * 0.55))} r="5" fill="#effaf9" /></svg><div className="trace-footer"><span>Start</span><span>{riskSamples.some((sample) => sample.collision) ? "Collision in scenario" : "No collision in scenario"}</span><span>{scenario.duration}s</span></div></div>
        <BenchmarkPanel />
      </section>
      <aside className="control-column"><section className="panel"><p className="eyebrow">Test scenarios</p><div className="scenario-list">{SCENARIOS.map((item) => <button key={item.id} className={"scenario-choice " + (item.id === scenarioId ? "selected" : "")} onClick={() => chooseScenario(item.id)}><span>{item.name}</span><span aria-hidden="true">↗</span></button>)}</div></section>
        <section className="panel settings-panel"><p className="eyebrow">Live controls</p><label>Vehicle A speed <input type="number" min="0.5" max="1.5" step="0.1" value={speedScale} onChange={(event) => { setPlaying(false); setTime(0); setBounded(event.target.value, 0.5, 1.5, setSpeedScale); }} /><span>× original speed</span></label><label>Look-ahead <input type="number" min="0.5" max="8" step="0.5" value={horizon} onChange={(event) => setBounded(event.target.value, 0.5, 8, setHorizon)} /><span>seconds</span></label><label>Safety margin <input type="number" min="0" max="60" step="1" value={margin} onChange={(event) => setBounded(event.target.value, 0, 60, setMargin)} /><span>units</span></label></section>
        <section className="panel metrics-panel"><p className="eyebrow">Live prediction</p><div className="metric"><span>Closest projected gap</span><strong>{Number.isFinite(prediction.gap) ? Math.max(0, prediction.gap).toFixed(1) : "—"} <small>units</small></strong></div><div className="metric"><span>Time to closest approach</span><strong>{prediction.seconds.toFixed(1)} <small>s</small></strong></div><div className="metric"><span>Vehicles tracked</span><strong>{vehicles.length}</strong></div></section>
        <p className="footnote">Predictions assume each vehicle keeps its current speed and direction. This is a simulation, not a road-safety system.</p>
      </aside>
    </div>
  </main>;
}
