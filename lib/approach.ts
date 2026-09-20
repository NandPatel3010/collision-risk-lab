export type ScaleSample = { time: number; scale: number };

export type ApproachEstimate = {
  seconds: number | null;
  trend: "approaching" | "steady" | "receding" | "measuring";
  quality: number;
  growthPercent: number;
};

export const emptyEstimate: ApproachEstimate = { seconds: null, trend: "measuring", quality: 0, growthPercent: 0 };

/** Monocular time-to-contact: inverse apparent size is approximately linear in time. */
export function estimateApproach(samples: ScaleSample[]): ApproachEstimate {
  const valid = samples.filter((sample) => Number.isFinite(sample.time) && Number.isFinite(sample.scale) && sample.scale > 0);
  if (valid.length < 4 || valid.at(-1)!.time - valid[0].time < 0.42) return emptyEstimate;

  // For an object of roughly fixed physical size, inverse image size is
  // approximately proportional to distance from a stationary camera.
  const origin = valid[0].time;
  const points = valid.map(({ time, scale }) => ({ x: time - origin, y: 1 / scale }));
  const n = points.length;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / n;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / n;
  const xx = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  if (xx === 0) return emptyEstimate;
  const slope = points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0) / xx;
  const intercept = meanY - slope * meanX;
  const residual = points.reduce((sum, point) => sum + (point.y - intercept - slope * point.x) ** 2, 0);
  const total = points.reduce((sum, point) => sum + (point.y - meanY) ** 2, 0);
  const quality = total > 0 ? Math.max(0, Math.min(1, 1 - residual / total)) : 0;
  const growthPercent = (valid.at(-1)!.scale / valid[0].scale - 1) * 100;

  if (growthPercent < -3 && slope > 0) return { seconds: null, trend: "receding", quality, growthPercent };
  if (growthPercent < 3 || slope >= 0) return { seconds: null, trend: "steady", quality, growthPercent };
  const currentInverseScale = 1 / valid.at(-1)!.scale;
  const seconds = -currentInverseScale / slope;
  if (quality < 0.4 || !Number.isFinite(seconds) || seconds < 0.25 || seconds > 30) {
    return { seconds: null, trend: "measuring", quality, growthPercent };
  }
  return { seconds, trend: "approaching", quality, growthPercent };
}
