export type TrackedBox = { x: number; y: number; width: number; height: number };
export type Detection = { label: string; box: TrackedBox; confidence?: number };
export type TrackPoint = { time: number; x: number; y: number; width: number; height: number; confidence: number };
export type ObjectTrack = { id: number; label: string; box: TrackedBox; confidence: number; points: TrackPoint[]; missed: number; hits: number };
export type PairPrediction = {
  seconds: number;
  impactAt: number;
  updatedAt: number;
  moving: string;
  stationary: string;
  movingId: number;
  stationaryId: number;
  quality: number;
};

type Motion = { x: number; y: number; vx: number; vy: number; speed: number; travel: number; quality: number; confidence: number };
const center = (box: TrackedBox) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function area(box: TrackedBox) { return Math.max(1, box.width * box.height); }

function iou(a: TrackedBox, b: TrackedBox) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const overlap = width * height;
  return overlap / Math.max(1, area(a) + area(b) - overlap);
}

function movement(track: ObjectTrack, now: number): Motion | null {
  if (track.points.length < 3 || track.missed > 2) return null;
  const points = track.points.filter((point) => now - point.time <= 1.8);
  if (points.length < 3) return null;
  const first = points[0], last = points.at(-1)!;
  const duration = last.time - first.time;
  if (duration < 0.32) return null;

  // Median pairwise velocity resists a single bad detection better than a raw
  // frame-to-frame difference or an ordinary least-squares fit.
  const xSlopes: number[] = [], ySlopes: number[] = [];
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    const dt = points[j].time - points[i].time;
    if (dt >= 0.12) {
      xSlopes.push((points[j].x - points[i].x) / dt);
      ySlopes.push((points[j].y - points[i].y) / dt);
    }
  }
  if (!xSlopes.length) return null;
  const vx = median(xSlopes), vy = median(ySlopes), speed = Math.hypot(vx, vy);
  const interceptX = median(points.map((point) => point.x - vx * point.time));
  const interceptY = median(points.map((point) => point.y - vy * point.time));
  const residuals = points.map((point) => Math.hypot(point.x - (interceptX + vx * point.time), point.y - (interceptY + vy * point.time)));
  const typicalError = median(residuals);
  const quality = clamp(1 - typicalError / Math.max(speed * duration * 0.45, Math.hypot(track.box.width, track.box.height) * 0.12, 6), 0, 1);
  const confidence = median(points.slice(-5).map((point) => point.confidence));
  return { x: interceptX + vx * now, y: interceptY + vy * now, vx, vy, speed, travel: speed * duration, quality, confidence };
}

function predictedBox(track: ObjectTrack, time: number, width: number, height: number): TrackedBox {
  const projected = movement(track, time);
  const point = projected ?? center(track.box);
  // Keep shape changes gradual; apparent scale jitter should not make a target
  // suddenly become a much larger collision surface.
  const recent = track.points.slice(-4);
  const w = median(recent.map((sample) => sample.width));
  const h = median(recent.map((sample) => sample.height));
  return { x: clamp(point.x - w / 2, 0, width - w), y: clamp(point.y - h / 2, 0, height - h), width: w, height: h };
}

/** Associate boxes by predicted position, overlap, and scale to reduce ID swaps. */
export function updateObjectTracks(previous: ObjectTrack[], detections: Detection[], time: number, width: number, height: number, nextId: number) {
  const diagonal = Math.hypot(width, height);
  const candidates: { old: number; fresh: number; cost: number }[] = [];
  for (let old = 0; old < previous.length; old++) {
    const track = previous[old];
    if (track.missed > 3) continue;
    const last = track.points.at(-1);
    if (!last) continue;
    const dt = Math.max(0.05, time - last.time);
    const predicted = movement(track, time) ?? { x: last.x, y: last.y };
    const motionPrediction = { ...track.box, x: predicted.x - track.box.width / 2, y: predicted.y - track.box.height / 2 };
    const gate = diagonal * clamp(0.055 + dt * 0.34, 0.06, 0.19);
    for (let fresh = 0; fresh < detections.length; fresh++) {
      const detection = detections[fresh];
      if (detection.label !== track.label) continue;
      const point = center(detection.box);
      const distance = Math.hypot(point.x - predicted.x, point.y - predicted.y);
      if (distance > gate) continue;
      const scaleChange = Math.abs(Math.log(area(detection.box) / area(track.box)));
      const cost = distance / gate * 0.64 + (1 - iou(motionPrediction, detection.box)) * 0.25 + Math.min(1, scaleChange / 1.4) * 0.11;
      candidates.push({ old, fresh, cost });
    }
  }
  candidates.sort((a, b) => a.cost - b.cost);
  const oldToFresh = new Map<number, number>(), usedFresh = new Set<number>();
  for (const candidate of candidates) if (!oldToFresh.has(candidate.old) && !usedFresh.has(candidate.fresh)) {
    oldToFresh.set(candidate.old, candidate.fresh);
    usedFresh.add(candidate.fresh);
  }

  const tracks: ObjectTrack[] = [];
  const ids: number[] = Array(detections.length).fill(0);
  for (let index = 0; index < detections.length; index++) {
    const detection = detections[index], point = center(detection.box);
    const oldIndex = [...oldToFresh].find(([, fresh]) => fresh === index)?.[0];
    if (oldIndex !== undefined) {
      const old = previous[oldIndex], confidence = detection.confidence ?? 1;
      const points = [...old.points, { time, ...point, width: detection.box.width, height: detection.box.height, confidence }]
        .filter((sample) => time - sample.time <= 1.8).slice(-12);
      const track = { ...old, box: detection.box, confidence, points, missed: 0, hits: old.hits + 1 };
      tracks.push(track);
      ids[index] = track.id;
    } else {
      const id = nextId++, confidence = detection.confidence ?? 1;
      const track: ObjectTrack = { id, label: detection.label, box: detection.box, confidence,
        points: [{ time, ...point, width: detection.box.width, height: detection.box.height, confidence }], missed: 0, hits: 1 };
      tracks.push(track);
      ids[index] = id;
    }
  }
  for (let index = 0; index < previous.length; index++) {
    const old = previous[index];
    if (oldToFresh.has(index)) continue;
    const missed = old.missed + 1;
    if (missed <= 3 && time - (old.points.at(-1)?.time ?? time) <= 0.8) tracks.push({ ...old, missed });
  }
  return { tracks, ids, nextId };
}

function rayBoxTime(x: number, y: number, vx: number, vy: number, box: TrackedBox, halfWidth: number, halfHeight: number) {
  // Long linear extrapolations amplify small tracking errors. Only show a
  // collision estimate once the projected overlap is within a short horizon.
  const horizon = 4;
  const axes = [
    { point: x - (box.x + box.width / 2), velocity: vx, extent: (box.width + halfWidth * 2) / 2 },
    { point: y - (box.y + box.height / 2), velocity: vy, extent: (box.height + halfHeight * 2) / 2 },
  ];
  let enter = 0, exit = horizon;
  for (const axis of axes) {
    if (Math.abs(axis.velocity) < 0.5) {
      if (Math.abs(axis.point) > axis.extent) return null;
      continue;
    }
    const first = (-axis.extent - axis.point) / axis.velocity;
    const last = (axis.extent - axis.point) / axis.velocity;
    enter = Math.max(enter, Math.min(first, last));
    exit = Math.min(exit, Math.max(first, last));
    if (enter > exit) return null;
  }
  return exit < 0.08 || enter > horizon ? null : Math.max(0, enter);
}

/** Predict when a moving silhouette would overlap a still silhouette in the 2D camera view. */
export function predictObjectContact(tracks: ObjectTrack[], width: number, height: number, now: number): PairPrediction | null {
  const diagonal = Math.hypot(width, height);
  const ready = tracks.flatMap((track) => {
    const motion = movement(track, now);
    return motion && motion.confidence >= 0.28 ? [{ track, motion }] : [];
  });
  const stationary = ready.filter(({ track, motion }) => track.points.at(-1)!.time - track.points[0].time >= 0.5 && motion.speed <= diagonal * 0.012);
  const moving = ready.filter(({ motion }) => motion.speed >= diagonal * 0.016 && motion.travel >= Math.max(10, diagonal * 0.012) && motion.quality >= 0.28);
  let best: PairPrediction | null = null;
  for (const from of moving) for (const to of stationary) {
    if (from.track.id === to.track.id) continue;
    const movingBox = predictedBox(from.track, now, width, height);
    const stationaryBox = predictedBox(to.track, now, width, height);
    const seconds = rayBoxTime(movingBox.x + movingBox.width / 2, movingBox.y + movingBox.height / 2,
      from.motion.vx - to.motion.vx, from.motion.vy - to.motion.vy, stationaryBox, movingBox.width / 2, movingBox.height / 2);
    if (seconds === null) continue;
    const prediction: PairPrediction = { seconds, impactAt: now + seconds, updatedAt: now,
      moving: from.track.label, stationary: to.track.label, movingId: from.track.id, stationaryId: to.track.id, quality: from.motion.quality };
    if (!best || prediction.seconds < best.seconds) best = prediction;
  }
  return best;
}
