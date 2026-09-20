export type TrackedBox = { x: number; y: number; width: number; height: number };
export type Detection = { label: string; box: TrackedBox };
export type TrackPoint = { time: number; x: number; y: number };
export type ObjectTrack = { id: number; label: string; box: TrackedBox; points: TrackPoint[]; missed: number };
export type PairPrediction = {
  seconds: number;
  moving: string;
  stationary: string;
  movingId: number;
  stationaryId: number;
  quality: number;
};

const center = (box: TrackedBox) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

export function updateObjectTracks(previous: ObjectTrack[], detections: Detection[], time: number, width: number, height: number, nextId: number) {
  const used = new Set<number>();
  const tracks: ObjectTrack[] = [];
  const ids: number[] = [];
  for (const detection of detections) {
    const point = center(detection.box);
    const match = previous.map((track) => {
      const old = center(track.box);
      return { track, distance: Math.hypot((point.x - old.x) / width, (point.y - old.y) / height) };
    }).filter(({ track, distance }) => !used.has(track.id) && track.label === detection.label && distance < 0.24)
      .sort((a, b) => a.distance - b.distance)[0]?.track;
    if (match) {
      used.add(match.id);
      tracks.push({ ...match, box: detection.box, points: [...match.points, { time, ...point }].filter((sample) => time - sample.time <= 2.4), missed: 0 });
      ids.push(match.id);
    } else {
      const id = nextId++;
      tracks.push({ id, label: detection.label, box: detection.box, points: [{ time, ...point }], missed: 0 });
      ids.push(id);
    }
  }
  for (const old of previous) if (!used.has(old.id) && !ids.includes(old.id) && old.missed < 3) tracks.push({ ...old, missed: old.missed + 1 });
  return { tracks, ids, nextId };
}

function motion(track: ObjectTrack) {
  const points = track.points;
  if (track.missed || points.length < 4) return null;
  const duration = points.at(-1)!.time - points[0].time;
  if (duration < 0.7) return null;
  const meanT = points.reduce((sum, point) => sum + point.time, 0) / points.length;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const denominator = points.reduce((sum, point) => sum + (point.time - meanT) ** 2, 0);
  if (denominator <= 0) return null;
  const vx = points.reduce((sum, point) => sum + (point.time - meanT) * (point.x - meanX), 0) / denominator;
  const vy = points.reduce((sum, point) => sum + (point.time - meanT) * (point.y - meanY), 0) / denominator;
  const residual = points.reduce((sum, point) => sum + (point.x - meanX - vx * (point.time - meanT)) ** 2 + (point.y - meanY - vy * (point.time - meanT)) ** 2, 0);
  const total = points.reduce((sum, point) => sum + (point.x - meanX) ** 2 + (point.y - meanY) ** 2, 0);
  const quality = total > 0 ? Math.max(0, Math.min(1, 1 - residual / total)) : 1;
  const start = points[0], end = points.at(-1)!;
  const displacement = Math.hypot(end.x - start.x, end.y - start.y);
  return { vx, vy, quality, displacement, x: end.x, y: end.y };
}

function rayBoxTime(x: number, y: number, vx: number, vy: number, box: TrackedBox, halfWidth: number, halfHeight: number) {
  const bounds = [
    { point: x, velocity: vx, min: box.x - halfWidth, max: box.x + box.width + halfWidth },
    { point: y, velocity: vy, min: box.y - halfHeight, max: box.y + box.height + halfHeight },
  ];
  let enter = 0, exit = 8;
  for (const axis of bounds) {
    if (Math.abs(axis.velocity) < 0.01) {
      if (axis.point < axis.min || axis.point > axis.max) return null;
      continue;
    }
    const first = (axis.min - axis.point) / axis.velocity;
    const last = (axis.max - axis.point) / axis.velocity;
    enter = Math.max(enter, Math.min(first, last));
    exit = Math.min(exit, Math.max(first, last));
    if (enter > exit) return null;
  }
  return enter >= 0.25 && enter <= 8 ? enter : null;
}

/** Predict overlap in the camera image, not a confirmed 3D collision. */
export function predictObjectContact(tracks: ObjectTrack[], width: number, height: number): PairPrediction | null {
  const diagonal = Math.hypot(width, height);
  const ready = tracks.flatMap((track) => {
    const movement = motion(track);
    return movement ? [{ track, movement }] : [];
  });
  const stationary = ready.filter(({ movement }) => movement.displacement < diagonal * 0.018);
  const moving = ready.filter(({ movement }) => movement.displacement > diagonal * 0.035 && movement.quality >= 0.55);
  let best: PairPrediction | null = null;
  for (const from of moving) for (const to of stationary) {
    if (from.track.id === to.track.id) continue;
    const seconds = rayBoxTime(from.movement.x, from.movement.y, from.movement.vx, from.movement.vy,
      to.track.box, from.track.box.width / 2, from.track.box.height / 2);
    if (seconds === null) continue;
    const prediction = { seconds, moving: from.track.label, stationary: to.track.label,
      movingId: from.track.id, stationaryId: to.track.id, quality: from.movement.quality };
    if (!best || prediction.seconds < best.seconds) best = prediction;
  }
  return best;
}
