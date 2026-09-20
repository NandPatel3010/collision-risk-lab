"use client";

import { useEffect, useRef, useState } from "react";
import { estimateApproach, type ApproachEstimate, type ScaleSample } from "@/lib/approach";

type Box = { x: number; y: number; width: number; height: number };
type SeenObject = { box: Box; label: string; score: number };
type StoredSample = { elapsedMs: number; scale: number; rawTtc: number | null; quality: number };
type ActiveRun = { id: string; startAt: number };
type CameraResponse = { id: string; factor: number; verifiedRuns: number; learned: boolean; error?: string };
type VisionDetector = {
  detectForVideo: (video: HTMLVideoElement, timestamp: number) => {
    detections: Array<{
      boundingBox?: { originX: number; originY: number; width: number; height: number };
      categories: Array<{ categoryName?: string; displayName?: string; score: number }>;
    }>;
  };
  close: () => void;
};

const initialEstimate: ApproachEstimate = { seconds: null, trend: "measuring", quality: 0 };

function centerDistance(a: Box, b: Box, width: number, height: number) {
  const dx = (a.x + a.width / 2 - b.x - b.width / 2) / width;
  const dy = (a.y + a.height / 2 - b.y - b.height / 2) / height;
  return Math.hypot(dx, dy);
}

export default function CameraLab() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<VisionDetector | null>(null);
  const frameRef = useRef<number | null>(null);
  const sessionRef = useRef(0);
  const lastInferenceRef = useRef(0);
  const targetRef = useRef<SeenObject | null>(null);
  const samplesRef = useRef<ScaleSample[]>([]);
  const runRef = useRef<ActiveRun | null>(null);
  const pendingSamplesRef = useRef<StoredSample[]>([]);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const runTokenRef = useRef(0);
  const lastSaveRef = useRef(0);
  const [status, setStatus] = useState<"idle" | "loading" | "live" | "error">("idle");
  const [error, setError] = useState("");
  const [objects, setObjects] = useState<SeenObject[]>([]);
  const [targetIndex, setTargetIndex] = useState<number | null>(null);
  const [targetName, setTargetName] = useState("None selected");
  const [estimate, setEstimate] = useState<ApproachEstimate>(initialEstimate);
  const [hint, setHint] = useState("Start the camera, then select an outlined object.");
  const [videoSize, setVideoSize] = useState({ width: 1280, height: 720 });
  const [calibration, setCalibration] = useState({ factor: 1, verifiedRuns: 0 });
  const [saveStatus, setSaveStatus] = useState("Select an object to record a test run.");
  const [savingReference, setSavingReference] = useState(false);

  const postMeasurement = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/camera", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json() as CameraResponse;
    if (!response.ok) throw new Error(result.error || "Could not save measurements.");
    return result;
  };

  useEffect(() => {
    fetch("/api/camera").then((response) => response.json() as Promise<CameraResponse>).then((data) => {
      if (typeof data.factor === "number") setCalibration({ factor: data.factor, verifiedRuns: data.verifiedRuns });
      else setSaveStatus("Measurement storage is unavailable. Camera estimates still work.");
    }).catch(() => setSaveStatus("Measurement storage is unavailable. Camera estimates still work."));
  }, []);

  const flushSamples = (run: ActiveRun) => {
    const batch = pendingSamplesRef.current.splice(0);
    if (!batch.length) return saveQueueRef.current;
    saveQueueRef.current = saveQueueRef.current.catch(() => {}).then(async () => {
      try {
        await postMeasurement({ action: "samples", id: run.id, samples: batch });
        setSaveStatus("Measurements saved live · video stays on this device.");
      } catch {
        setSaveStatus("Some measurements could not be saved. Check your connection.");
        throw new Error("Measurement save failed.");
      }
    });
    return saveQueueRef.current;
  };

  const endRun = async () => {
    runTokenRef.current += 1;
    const run = runRef.current;
    runRef.current = null;
    if (!run) return;
    try {
      await flushSamples(run);
      await postMeasurement({ action: "stop", id: run.id });
    } catch { setSaveStatus("Some measurements could not be saved. Check your connection."); }
  };

  const release = () => {
    void endRun();
    sessionRef.current += 1;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    detectorRef.current?.close();
    detectorRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    targetRef.current = null;
    samplesRef.current = [];
  };

  useEffect(() => () => release(), []);

  const stopCamera = () => {
    release();
    setStatus("idle");
    setObjects([]);
    setTargetIndex(null);
    setTargetName("None selected");
    setEstimate(initialEstimate);
    setHint("Start the camera, then select an outlined object.");
  };

  const selectObject = (object: SeenObject, index: number) => {
    void endRun();
    const token = runTokenRef.current;
    const startAt = performance.now();
    pendingSamplesRef.current = [];
    setSaveStatus("Starting a saved test run…");
    postMeasurement({ action: "start", label: object.label }).then((data) => {
      if (token !== runTokenRef.current) { void postMeasurement({ action: "stop", id: data.id }); return; }
      runRef.current = { id: data.id, startAt };
      setCalibration({ factor: data.factor, verifiedRuns: data.verifiedRuns });
      setSaveStatus("Recording measurements live · video stays on this device.");
    }).catch(() => setSaveStatus("Measurement storage is unavailable. Camera estimates still work."));
    targetRef.current = object;
    samplesRef.current = [];
    setTargetIndex(index);
    setTargetName(object.label);
    setEstimate(initialEstimate);
    setHint("Keep the camera still and move the object slowly toward it.");
  };

  const processFrame = (detector: VisionDetector, session: number) => {
    if (session !== sessionRef.current) return;
    const video = videoRef.current;
    const now = performance.now();
    if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - lastInferenceRef.current >= 150) {
      lastInferenceRef.current = now;
      try {
        const width = video.videoWidth;
        const height = video.videoHeight;
        const result = detector.detectForVideo(video, now);
        const visible = result.detections.flatMap((item) => {
          const box = item.boundingBox;
          const category = item.categories[0];
          if (!box || !category) return [];
          return [{ box: { x: box.originX, y: box.originY, width: box.width, height: box.height }, label: category.categoryName || category.displayName || "Object", score: category.score }];
        });
        setObjects(visible);

        const prior = targetRef.current;
        if (prior) {
          const matching = visible.map((object, index) => ({ object, index, distance: centerDistance(prior.box, object.box, width, height) }))
            .filter((item) => item.object.label === prior.label && item.distance < 0.27)
            .sort((a, b) => a.distance - b.distance)[0];
          if (matching) {
            targetRef.current = matching.object;
            setTargetIndex(matching.index);
            const { box } = matching.object;
            const cropped = box.x < 4 || box.y < 4 || box.x + box.width > width - 4 || box.y + box.height > height - 4;
            if (cropped) {
              samplesRef.current = [];
              setEstimate(initialEstimate);
              setHint("Keep the whole object inside the camera view.");
            } else {
              const scale = Math.sqrt(box.width * box.height / (width * height));
              samplesRef.current = [...samplesRef.current, { time: now / 1000, scale }].filter((sample) => now / 1000 - sample.time <= 1.8);
              const next = estimateApproach(samplesRef.current);
              setEstimate(next);
              const run = runRef.current;
              if (run) {
                pendingSamplesRef.current.push({ elapsedMs: Math.round(now - run.startAt), scale, rawTtc: next.seconds, quality: next.quality });
                if (now - lastSaveRef.current >= 1000 || pendingSamplesRef.current.length >= 24) {
                  lastSaveRef.current = now;
                  void flushSamples(run).catch(() => {});
                }
              }
              setHint(next.trend === "approaching" ? "Approach detected. Estimate assumes steady motion." : next.trend === "receding" ? "Object is moving away." : next.trend === "steady" ? "No clear approach detected." : "Measuring movement—keep the object visible.");
            }
          } else {
            void endRun();
            samplesRef.current = [];
            setTargetIndex(null);
            setEstimate(initialEstimate);
            setHint("Selected object lost. Select an outlined object to try again.");
            targetRef.current = null;
            setTargetName("None selected");
          }
        } else if (visible.length && !targetRef.current) {
          setHint("Select an outlined object to track its approach.");
        }
      } catch {
        setHint("Detection paused. Try restarting the camera.");
      }
    }
    frameRef.current = requestAnimationFrame(() => processFrame(detector, session));
  };

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser does not support camera access. Use a current browser on HTTPS or localhost.");
      setStatus("error");
      return;
    }
    release();
    const session = sessionRef.current;
    setError("");
    setStatus("loading");
    setHint("Requesting camera access and loading the object detector…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (session !== sessionRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Camera preview is unavailable.");
      video.srcObject = stream;
      await video.play();
      setVideoSize({ width: video.videoWidth || 1280, height: video.videoHeight || 720 });
      const modulePath = "/vision/vision_bundle.mjs";
      const vision = await import(/* @vite-ignore */ modulePath);
      const fileset = await vision.FilesetResolver.forVisionTasks("/vision/wasm");
      const detector: VisionDetector = await vision.ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: "/vision/efficientdet_lite0_uint8.tflite" },
        runningMode: "VIDEO",
        maxResults: 8,
        scoreThreshold: 0.4,
      });
      if (session !== sessionRef.current) { detector.close(); return; }
      detectorRef.current = detector;
      setStatus("live");
      setHint("Select an outlined object to track its approach.");
      lastInferenceRef.current = 0;
      processFrame(detector, session);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Camera could not start.";
      release();
      setError(message.includes("Permission denied") || message.includes("NotAllowed") ? "Camera access was denied. Allow access in your browser and try again." : `Camera mode could not start: ${message}`);
      setStatus("error");
    }
  };

  const markReference = async () => {
    const run = runRef.current;
    if (!run || savingReference) return;
    const referenceElapsedMs = Math.round(performance.now() - run.startAt);
    runRef.current = null;
    runTokenRef.current += 1;
    setSavingReference(true);
    try {
      await flushSamples(run);
      const result = await postMeasurement({ action: "finish", id: run.id, referenceElapsedMs });
      setCalibration({ factor: result.factor, verifiedRuns: result.verifiedRuns });
      setSaveStatus(result.learned ? "Trial saved. Future estimates now use the updated calibration." : "Trial saved, but it needs at least 3 reliable predictions to update calibration.");
    } catch { setSaveStatus("Could not finish this trial. Check your connection."); }
    targetRef.current = null;
    samplesRef.current = [];
    setTargetIndex(null);
    setTargetName("None selected");
    setEstimate(initialEstimate);
    setHint("Select an outlined object to start another test run.");
    setSavingReference(false);
  };

  const adjustedSeconds = estimate.seconds === null ? null : estimate.seconds * calibration.factor;
  const risk = adjustedSeconds !== null && adjustedSeconds < 3;
  const cameraOn = status === "live" || status === "loading";
  return <main className="camera-app">
    <header className="app-header"><div><strong>Collision Risk Lab</strong><span>Camera approach test</span></div><span className={"camera-status " + (status === "live" ? "online" : "")}>{status === "live" ? "Camera on" : status === "loading" ? "Starting camera" : "Camera off"}</span></header>
    <div className="app-content">
      <section className="camera-area" aria-label="Webcam approach detection">
        <div className="section-top"><div><h1>Live camera</h1><p>Select a detected object, then move it toward a stationary camera.</p></div><button type="button" className={cameraOn ? "control-button secondary" : "control-button primary"} onClick={cameraOn ? stopCamera : startCamera}>{cameraOn ? "Stop camera" : "Start camera"}</button></div>
        <div className="camera-frame" style={{ aspectRatio: `${videoSize.width} / ${videoSize.height}` }}>
          <video ref={videoRef} playsInline muted aria-label="Live webcam preview" aria-hidden={status !== "live"} />
          {status === "live" && objects.map((object, index) => <button key={`${object.label}-${index}`} type="button" className={"camera-box " + (targetIndex === index ? "selected" : "")} style={{ left: `${object.box.x / videoSize.width * 100}%`, top: `${object.box.y / videoSize.height * 100}%`, width: `${object.box.width / videoSize.width * 100}%`, height: `${object.box.height / videoSize.height * 100}%` }} onClick={() => selectObject(object, index)} aria-label={`Track ${object.label}, ${Math.round(object.score * 100)} percent confidence`}><span>{targetIndex === index ? "TRACKING · " : "DETECTED · "}{object.label} · {Math.round(object.score * 100)}%</span></button>)}
          {status !== "live" && <div className="camera-placeholder"><strong>{status === "loading" ? "Preparing camera…" : "Camera is off"}</strong><span>{status === "loading" ? "Loading object detection on this device." : "Press Start camera to begin."}</span></div>}
          {status === "live" && <div className="video-count">{objects.length} object{objects.length === 1 ? "" : "s"} detected</div>}
        </div>
        <p className="camera-hint" role="status">{hint}</p>
        {error && <p className="error-message" role="alert">{error}</p>}
        <p className="test-instructions"><strong>Test setup:</strong> Keep the laptop still, select an outlined object, and move it slowly toward the camera while keeping it fully in view. Stop safely at the same reference point each time, then mark it below.</p>
      </section>
      <aside className="readings" aria-label="Approach estimate">
        <div className="main-reading"><div className="reading-label">Estimated approach time</div><div className={"reading-value " + (risk ? "risk" : "")} aria-live="polite">{adjustedSeconds === null ? "—" : adjustedSeconds.toFixed(1)}{adjustedSeconds !== null && <span> s</span>}</div><p>{adjustedSeconds === null ? "No reliable estimate yet" : "At the current rate of approach"}</p></div>
        <dl className="tracking-details"><div><dt>Selected object</dt><dd>{targetName}</dd></div><div><dt>Motion</dt><dd className="capitalized">{estimate.trend}</dd></div><div><dt>Trend consistency</dt><dd>{estimate.quality ? `${Math.round(estimate.quality * 100)}%` : "—"}</dd></div></dl>
        <div className="run-controls"><button type="button" className="control-button primary" onClick={markReference} disabled={!runRef.current || savingReference}>{savingReference ? "Saving trial…" : "Mark reference reached"}</button><p>Mark only when the object reaches your repeatable, safe stopping point.</p><div className="calibration-line">Calibration: {calibration.verifiedRuns} verified trial{calibration.verifiedRuns === 1 ? "" : "s"} · {calibration.factor.toFixed(2)}×</div><p role="status">{saveStatus}</p></div>
        <p className="privacy-note">Only numeric measurements and the object label are saved. Video is processed in your browser, never uploaded or saved. The estimate is based on apparent size; marked trials calibrate it to your reference point. Not a safety device.</p>
      </aside>
    </div>
  </main>;
}
