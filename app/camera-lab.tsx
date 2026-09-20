"use client";

import { useEffect, useRef, useState } from "react";
import { estimateApproach, type ApproachEstimate, type ScaleSample } from "@/lib/approach";

type Box = { x: number; y: number; width: number; height: number };
type SeenObject = { box: Box; label: string; score: number };
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
  const [status, setStatus] = useState<"idle" | "loading" | "live" | "error">("idle");
  const [error, setError] = useState("");
  const [objects, setObjects] = useState<SeenObject[]>([]);
  const [targetIndex, setTargetIndex] = useState<number | null>(null);
  const [targetName, setTargetName] = useState("None selected");
  const [estimate, setEstimate] = useState<ApproachEstimate>(initialEstimate);
  const [hint, setHint] = useState("Start the camera, then select an outlined object.");
  const [videoSize, setVideoSize] = useState({ width: 1280, height: 720 });

  const release = () => {
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
              setHint(next.trend === "approaching" ? "Approach detected. Estimate assumes steady motion." : next.trend === "receding" ? "Object is moving away." : next.trend === "steady" ? "No clear approach detected." : "Measuring movement—keep the object visible.");
            }
          } else {
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

  const risk = estimate.seconds !== null && estimate.seconds < 3;
  return <div className="camera-workspace">
    <section className="stage-column" aria-label="Webcam approach detection">
      <div className="section-heading"><div><p className="eyebrow">Webcam mode</p><h1>Approach detection</h1><p className="description">Track an object moving toward your laptop camera.</p></div><span className={"status-pill " + (risk ? "warning" : status === "live" ? "clear" : "") }><span className="status-dot" />{risk ? "Approaching" : status === "live" ? "Camera live" : status === "loading" ? "Starting" : "Camera off"}</span></div>
      <div className="camera-frame" style={{ aspectRatio: `${videoSize.width} / ${videoSize.height}` }}>
        <video ref={videoRef} playsInline muted aria-label="Live webcam preview" />
        {status === "live" && objects.map((object, index) => <button key={`${object.label}-${index}`} type="button" className={"camera-box " + (targetIndex === index ? "selected" : "")} style={{ left: `${object.box.x / videoSize.width * 100}%`, top: `${object.box.y / videoSize.height * 100}%`, width: `${object.box.width / videoSize.width * 100}%`, height: `${object.box.height / videoSize.height * 100}%` }} onClick={() => selectObject(object, index)} aria-label={`Track ${object.label}, ${Math.round(object.score * 100)} percent confidence`}><span>{object.label} · {Math.round(object.score * 100)}%</span></button>)}
        {status !== "live" && <div className="camera-placeholder"><div className="camera-symbol" aria-hidden="true">◉</div><strong>{status === "loading" ? "Preparing camera…" : "Webcam is off"}</strong><span>{status === "loading" ? "The detector loads on your device." : "Start it when you’re ready to test."}</span></div>}
        {status === "live" && <div className="frame-label">LIVE CAMERA <span>·</span> {objects.length} object{objects.length === 1 ? "" : "s"} detected</div>}
      </div>
      <div className="camera-actions"><button type="button" className="play-button" onClick={status === "live" || status === "loading" ? stopCamera : startCamera}>{status === "live" || status === "loading" ? "Stop camera" : "Start camera"}</button><span>{hint}</span></div>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="camera-note"><strong>How to test</strong><p>Keep your laptop still. Hold a recognizable object fully in view, select its outline, then slowly move it toward the camera. A person walking toward the camera also works.</p></div>
    </section>
    <aside className="control-column">
      <section className="panel camera-result"><p className="eyebrow">Live estimate</p><span className="camera-ttc">{estimate.seconds === null ? "—" : estimate.seconds.toFixed(1)}<small>{estimate.seconds === null ? "" : " s"}</small></span><strong>Time to contact</strong><p>{estimate.seconds === null ? "Waiting for a steady, measurable approach." : "Estimated time until the selected object reaches the camera plane if its motion stays constant."}</p></section>
      <section className="panel metrics-panel"><p className="eyebrow">Tracking details</p><div className="metric"><span>Selected object</span><strong>{targetName}</strong></div><div className="metric"><span>Motion</span><strong className="capitalized">{estimate.trend}</strong></div><div className="metric"><span>Fit quality</span><strong>{estimate.quality ? `${Math.round(estimate.quality * 100)}%` : "—"}</strong></div></section>
      <p className="footnote">Video stays in your browser and is not uploaded or saved. A single webcam cannot measure true distance in metres. This is a demonstration, not a safety device.</p>
    </aside>
  </div>;
}
