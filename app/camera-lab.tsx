"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { YOLO, type Results } from "@ultralytics/yolo";
import { emptyEstimate, estimateApproach, type ApproachEstimate, type ScaleSample } from "@/lib/approach";

type Box = { x: number; y: number; width: number; height: number };
type SeenObject = { box: Box; label: string; score: number };
type StoredSample = { elapsedMs: number; scale: number; rawTtc: number | null; quality: number };
type ActiveRun = { id: string; startAt: number };
type CameraResponse = { id: string; factor: number; verifiedRuns: number; learned: boolean; error?: string };

function centerDistance(a: Box, b: Box, width: number, height: number) {
  const dx = (a.x + a.width / 2 - b.x - b.width / 2) / width;
  const dy = (a.y + a.height / 2 - b.y - b.height / 2) / height;
  return Math.hypot(dx, dy);
}

function drawContours(canvas: HTMLCanvasElement, result: Results, objects: SeenObject[], selected: number | null) {
  const { width, height, masks } = result;
  const context = canvas.getContext("2d", { willReadFrequently: false });
  if (!context || !width || !height) return;
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  context.clearRect(0, 0, width, height);
  if (masks.length !== width * height * 4 || !objects.length) return;
  const edge = context.createImageData(width, height);
  const output = edge.data;
  const visible = objects.map(({ box }) => ({
    left: Math.max(0, Math.floor(box.x)), top: Math.max(0, Math.floor(box.y)),
    right: Math.min(width, Math.ceil(box.x + box.width)), bottom: Math.min(height, Math.ceil(box.y + box.height)),
  }));
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const pixel = y * width + x;
      const alpha = pixel * 4 + 3;
      if (masks[alpha] < 72) continue;
      const object = visible.findIndex((box) => x >= box.left && x < box.right && y >= box.top && y < box.bottom);
      if (object < 0) continue;
      if (masks[alpha - 4] >= 72 && masks[alpha + 4] >= 72 && masks[alpha - width * 4] >= 72 && masks[alpha + width * 4] >= 72) continue;
      const active = object === selected;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const index = ((y + dy) * width + x + dx) * 4;
        output[index] = active ? 255 : 47;
        output[index + 1] = active ? 209 : 208;
        output[index + 2] = active ? 102 : 255;
        output[index + 3] = 255;
      }
    }
  }
  context.putImageData(edge, 0, 0);
}

export default function CameraLab() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const contourRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<YOLO | null>(null);
  const frameRef = useRef<number | null>(null);
  const sessionRef = useRef(0);
  const lastInferenceRef = useRef(0);
  const targetRef = useRef<SeenObject | null>(null);
  const objectsRef = useRef<SeenObject[]>([]);
  const candidateRef = useRef<{ object: SeenObject; count: number } | null>(null);
  const missedRef = useRef(0);
  const autoSelectAfterRef = useRef(0);
  const smoothScaleRef = useRef<number | null>(null);
  const smoothSecondsRef = useRef<number | null>(null);
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
  const [targetName, setTargetName] = useState("No object tracked");
  const [estimate, setEstimate] = useState<ApproachEstimate>(emptyEstimate);
  const [hint, setHint] = useState("Start the camera. An object will be tracked automatically when it is clearly detected.");
  const [videoSize, setVideoSize] = useState({ width: 1280, height: 720 });
  const [calibration, setCalibration] = useState({ factor: 1, verifiedRuns: 0 });
  const [saveStatus, setSaveStatus] = useState("Measurements are saved when an object is tracked.");
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
      else setSaveStatus("Measurement storage is unavailable. Live estimates still work.");
    }).catch(() => setSaveStatus("Measurement storage is unavailable. Live estimates still work."));
  }, []);

  const flushSamples = (run: ActiveRun) => {
    const batch = pendingSamplesRef.current.splice(0);
    if (!batch.length) return saveQueueRef.current;
    saveQueueRef.current = saveQueueRef.current.catch(() => {}).then(async () => {
      await postMeasurement({ action: "samples", id: run.id, samples: batch });
      setSaveStatus("Measurements saved live · video stays on this device.");
    }).catch(() => { setSaveStatus("Some measurements could not be saved. Check your connection."); });
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
    detectorRef.current?.free();
    detectorRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    contourRef.current?.getContext("2d")?.clearRect(0, 0, contourRef.current.width, contourRef.current.height);
    targetRef.current = null;
    objectsRef.current = [];
    candidateRef.current = null;
    samplesRef.current = [];
    smoothScaleRef.current = null;
    smoothSecondsRef.current = null;
  };

  useEffect(() => () => release(), []);

  const stopCamera = () => {
    release();
    setStatus("idle");
    setObjects([]);
    setTargetIndex(null);
    setTargetName("No object tracked");
    setEstimate(emptyEstimate);
    setHint("Start the camera to track an object.");
  };

  const selectObject = (object: SeenObject, index: number) => {
    void endRun();
    const token = runTokenRef.current;
    const startAt = performance.now();
    pendingSamplesRef.current = [];
    setSaveStatus("Starting a saved test run…");
    postMeasurement({ action: "start", label: object.label }).then((data) => {
      if (token !== runTokenRef.current) { void postMeasurement({ action: "stop", id: data.id }).catch(() => {}); return; }
      runRef.current = { id: data.id, startAt };
      setCalibration({ factor: data.factor, verifiedRuns: data.verifiedRuns });
      setSaveStatus("Recording measurements live · video stays on this device.");
    }).catch(() => setSaveStatus("Measurement storage is unavailable. Live estimates still work."));
    targetRef.current = object;
    candidateRef.current = null;
    missedRef.current = 0;
    smoothScaleRef.current = null;
    smoothSecondsRef.current = null;
    samplesRef.current = [];
    setTargetIndex(index);
    setTargetName(object.label);
    setEstimate(emptyEstimate);
    setHint("Tracking started. Move the object toward a stationary camera to estimate contact time.");
  };

  const processFrame = async (detector: YOLO, session: number) => {
    if (session !== sessionRef.current) return;
    const video = videoRef.current;
    const now = performance.now();
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || now - lastInferenceRef.current < 180) {
      frameRef.current = requestAnimationFrame(() => { void processFrame(detector, session); });
      return;
    }
    lastInferenceRef.current = now;
    try {
      const result = await detector.predict(video, { conf: 0.48, iou: 0.6 });
      if (session !== sessionRef.current) return;
      const width = result.width || video.videoWidth;
      const height = result.height || video.videoHeight;
      const visible: SeenObject[] = result.boxes.filter((item) => item.conf >= 0.48 && item.x2 > item.x1 && item.y2 > item.y1)
        .sort((a, b) => b.conf - a.conf).slice(0, 8).map((item) => ({ box: { x: item.x1, y: item.y1, width: item.x2 - item.x1, height: item.y2 - item.y1 }, label: item.name || "Object", score: item.conf }));
      objectsRef.current = visible;
      setObjects(visible);
      setVideoSize((size) => size.width === width && size.height === height ? size : { width, height });

      const previous = targetRef.current;
      let selected = null as number | null;
      if (previous) {
        const match = visible.map((object, index) => ({ object, index, distance: centerDistance(previous.box, object.box, width, height) }))
          .filter((item) => item.object.label === previous.label && item.distance < 0.34)
          .sort((a, b) => a.distance - b.distance)[0];
        if (match) {
          missedRef.current = 0;
          selected = match.index;
          targetRef.current = match.object;
          setTargetIndex(selected);
          const box = match.object.box;
          const cropped = box.x < 3 || box.y < 3 || box.x + box.width > width - 3 || box.y + box.height > height - 3;
          if (cropped) {
            samplesRef.current = [];
            smoothScaleRef.current = null;
            smoothSecondsRef.current = null;
            setEstimate(emptyEstimate);
            setHint("Move the object fully into view so its apparent size can be measured.");
          } else {
            const scale = Math.sqrt(box.width * box.height / (width * height));
            const smoothScale = smoothScaleRef.current === null ? scale : smoothScaleRef.current * 0.45 + scale * 0.55;
            smoothScaleRef.current = smoothScale;
            const time = performance.now() / 1000;
            samplesRef.current = [...samplesRef.current, { time, scale: smoothScale }].filter((sample) => time - sample.time <= 4);
            const raw = estimateApproach(samplesRef.current);
            const seconds = raw.seconds === null ? null : smoothSecondsRef.current === null ? raw.seconds : smoothSecondsRef.current * 0.55 + raw.seconds * 0.45;
            smoothSecondsRef.current = seconds;
            setEstimate({ ...raw, seconds });
            const run = runRef.current;
            if (run) {
              pendingSamplesRef.current.push({ elapsedMs: Math.round(performance.now() - run.startAt), scale: smoothScale, rawTtc: raw.seconds, quality: raw.quality });
              if (performance.now() - lastSaveRef.current >= 1000 || pendingSamplesRef.current.length >= 24) {
                lastSaveRef.current = performance.now();
                void flushSamples(run);
              }
            }
            setHint(raw.seconds !== null ? "Approaching · estimate updates as the object moves." : raw.trend === "receding" ? "Moving away · no collision time to show." : raw.trend === "steady" ? "No clear approach · sideways or still motion has no contact-time estimate." : "Measuring approach · keep the object visible and move steadily toward the camera.");
          }
        } else {
          missedRef.current += 1;
          if (missedRef.current === 2) {
            samplesRef.current = [];
            smoothScaleRef.current = null;
            smoothSecondsRef.current = null;
            setEstimate(emptyEstimate);
          }
          if (missedRef.current >= 4) {
            void endRun();
            targetRef.current = null;
            samplesRef.current = [];
            smoothScaleRef.current = null;
            smoothSecondsRef.current = null;
            setTargetIndex(null);
            setTargetName("No object tracked");
            setEstimate(emptyEstimate);
            setHint("Object lost. Keep it in view or select another outline.");
          } else setHint("Briefly lost the object · trying to reacquire it.");
        }
      } else if (visible.length && now >= autoSelectAfterRef.current) {
        const best = visible.map((object, index) => ({ object, index, priority: object.score - centerDistance(object.box, { x: width * 0.25, y: height * 0.25, width: width * 0.5, height: height * 0.5 }, width, height) * 0.15 }))
          .sort((a, b) => b.priority - a.priority)[0];
        const candidate = candidateRef.current;
        const count = candidate && candidate.object.label === best.object.label && centerDistance(candidate.object.box, best.object.box, width, height) < 0.18 ? candidate.count + 1 : 1;
        candidateRef.current = { object: best.object, count };
        if (count >= 2) { selectObject(best.object, best.index); selected = best.index; }
        else setHint("Confirming object detection…");
      } else if (!visible.length) {
        candidateRef.current = null;
        if (!targetRef.current) setHint("No recognizable object in view. Try a well-lit person, bottle, cup, or chair.");
      }
      if (contourRef.current) drawContours(contourRef.current, result, visible, selected);
    } catch (cause) {
      if (session === sessionRef.current) setHint(`Detection paused: ${cause instanceof Error ? cause.message : "try restarting the camera"}`);
    }
    if (session === sessionRef.current) frameRef.current = requestAnimationFrame(() => { void processFrame(detector, session); });
  };

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera access is unavailable. Use a current browser on HTTPS or localhost.");
      setStatus("error");
      return;
    }
    release();
    const session = sessionRef.current;
    setError("");
    setStatus("loading");
    setHint("Requesting camera access and loading on-device segmentation…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 540 } } });
      if (session !== sessionRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Camera preview is unavailable.");
      video.srcObject = stream;
      await video.play();
      setVideoSize({ width: video.videoWidth || 960, height: video.videoHeight || 540 });
      const detector = await YOLO.load("/models/yolo26n-seg.onnx");
      if (session !== sessionRef.current) { detector.free(); return; }
      detectorRef.current = detector;
      setStatus("live");
      setHint("Looking for an object to track automatically…");
      lastInferenceRef.current = 0;
      void processFrame(detector, session);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Camera could not start.";
      release();
      setError(message.includes("Permission denied") || message.includes("NotAllowed") ? "Camera access was denied. Allow access in your browser and try again." : `Camera could not start: ${message}`);
      setStatus("error");
    }
  };

  const markReference = async () => {
    const run = runRef.current;
    if (!run || savingReference) return;
    const referenceElapsedMs = Math.round(performance.now() - run.startAt);
    runRef.current = null;
    runTokenRef.current += 1;
    autoSelectAfterRef.current = performance.now() + 1600;
    setSavingReference(true);
    try {
      await flushSamples(run);
      const result = await postMeasurement({ action: "finish", id: run.id, referenceElapsedMs });
      setCalibration({ factor: result.factor, verifiedRuns: result.verifiedRuns });
      setSaveStatus(result.learned ? "Trial saved. Future estimates now use updated calibration." : "Trial saved, but it needs more reliable predictions to update calibration.");
    } catch { setSaveStatus("Could not finish this trial. Check your connection."); }
    targetRef.current = null;
    samplesRef.current = [];
    smoothScaleRef.current = null;
    smoothSecondsRef.current = null;
    setTargetIndex(null);
    setTargetName("No object tracked");
    setEstimate(emptyEstimate);
    setHint("Move the object away, then approach again for another test.");
    setSavingReference(false);
  };

  const chooseAtPoint = (event: MouseEvent<HTMLDivElement>) => {
    if (status !== "live") return;
    const frame = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - frame.left) / frame.width * videoSize.width;
    const y = (event.clientY - frame.top) / frame.height * videoSize.height;
    const hit = objectsRef.current.map((object, index) => ({ object, index }))
      .filter(({ object }) => x >= object.box.x && x <= object.box.x + object.box.width && y >= object.box.y && y <= object.box.y + object.box.height)
      .sort((a, b) => a.object.box.width * a.object.box.height - b.object.box.width * b.object.box.height)[0];
    if (hit) selectObject(hit.object, hit.index);
  };

  const adjustedSeconds = estimate.seconds === null ? null : estimate.seconds * calibration.factor;
  const risk = adjustedSeconds !== null && adjustedSeconds < 3;
  const cameraOn = status === "live" || status === "loading";
  return <main className="camera-app">
    <header className="app-header"><div><strong>Collision Risk Lab</strong><span>Live approach measurement</span></div><span className={"camera-status " + (status === "live" ? "online" : "")}>{status === "live" ? "Camera on" : status === "loading" ? "Starting camera" : "Camera off"}</span></header>
    <div className="app-content">
      <section className="camera-area" aria-label="Webcam approach detection">
        <div className="section-top"><div><h1>Camera</h1><p>Keep the laptop still. Move an outlined object toward the lens.</p></div><button type="button" className={cameraOn ? "control-button secondary" : "control-button primary"} onClick={cameraOn ? stopCamera : startCamera}>{cameraOn ? "Stop camera" : "Start camera"}</button></div>
        <div className="camera-frame" style={{ aspectRatio: `${videoSize.width} / ${videoSize.height}` }} onClick={chooseAtPoint}>
          <video ref={videoRef} playsInline muted aria-label="Live webcam preview" aria-hidden={status !== "live"} />
          <canvas ref={contourRef} className="outline-layer" aria-hidden="true" />
          {status !== "live" && <div className="camera-placeholder"><strong>{status === "loading" ? "Preparing camera and segmentation…" : "Camera is off"}</strong><span>{status === "loading" ? "This may take a moment on first use." : "Press Start camera to begin."}</span></div>}
          {status === "live" && <div className="video-count">{objects.length} object{objects.length === 1 ? "" : "s"} outlined</div>}
        </div>
        <div className="camera-feedback"><p className="camera-hint" role="status">{hint}</p>{status === "live" && <span className="camera-legend"><i /> Tracking <i /> Other detected objects</span>}</div>
        {error && <p className="error-message" role="alert">{error}</p>}
        {status === "live" && objects.length > 1 && <div className="object-choices" aria-label="Detected objects">{objects.map((object, index) => <button key={`${object.label}-${index}`} type="button" className={targetIndex === index ? "object-choice active" : "object-choice"} onClick={() => selectObject(object, index)}>{object.label} <span>{Math.round(object.score * 100)}%</span></button>)}</div>}
        <p className="test-instructions">Contours follow the model’s estimated object shape. They may miss edges or misidentify objects, especially in low light. Tap an outline or use the object buttons to change what is tracked.</p>
      </section>
      <aside className="readings" aria-label="Approach estimate">
        <div className="main-reading"><div className="reading-label">TIME UNTIL CONTACT</div><div className={"reading-value " + (risk ? "risk" : "")} aria-live="polite">{adjustedSeconds === null ? "—" : adjustedSeconds.toFixed(1)}{adjustedSeconds !== null && <span> s</span>}</div><p>{adjustedSeconds !== null ? "Estimated from apparent growth" : targetName === "No object tracked" ? "Waiting for a tracked object" : estimate.trend === "steady" ? "No clear approach toward camera" : estimate.trend === "receding" ? "Object moving away" : "Measuring movement"}</p></div>
        <dl className="tracking-details"><div><dt>Tracking</dt><dd>{targetName}</dd></div><div><dt>Motion</dt><dd className="capitalized">{estimate.trend}</dd></div><div><dt>Apparent growth</dt><dd>{estimate.growthPercent ? `${estimate.growthPercent > 0 ? "+" : ""}${estimate.growthPercent.toFixed(1)}%` : "—"}</dd></div><div><dt>Signal quality</dt><dd>{estimate.quality ? `${Math.round(estimate.quality * 100)}%` : "—"}</dd></div></dl>
        <div className="run-controls"><button type="button" className="control-button primary" onClick={markReference} disabled={!runRef.current || savingReference}>{savingReference ? "Saving trial…" : "Mark reference reached"}</button><p>For calibration, stop the object at the same safe point each trial and mark it here.</p><div className="calibration-line">Calibration · {calibration.verifiedRuns} verified trial{calibration.verifiedRuns === 1 ? "" : "s"} · {calibration.factor.toFixed(2)}×</div><p role="status">{saveStatus}</p></div>
        <p className="privacy-note">Only numeric measurements and the object label are saved. Video is processed on this device. Contact time assumes roughly steady motion toward the camera; it is not a safety device.</p>
      </aside>
    </div>
  </main>;
}
