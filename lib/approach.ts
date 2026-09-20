export type ScaleSample = { time: number; scale: number };

export type ApproachEstimate = {
  seconds: number | null;
  trend: "approaching" | "steady" | "receding" | "measuring";
  quality: number;
};

/** Estimate time to the camera plane from changes in apparent object size. */
export function estimateApproach(samples: ScaleSample[]): ApproachEstimate {
  const valid = samples.filter((sample) => Number.isFinite(sample.time) && Number.isFinite(sample.scale) && sample.scale > 0);
  if (valid.length < 6 || valid.at(-1)!.time - valid[0].time < 0.65) {
    return { seconds: null, trend: "measuring", quality: 0 };
  }

  // For an object of roughly fixed physical size, inverse image size is
  // approximately proportional to distance from a stationary camera.
  const origin = valid[0].time;
  const points = valid.map(({ time, scale }) => ({ x: time - origin, y: 1 / scale }));
  const n = points.length;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / n;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / n;
  const xx = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  if (xx === 0) return { seconds: null, trend: "measuring", quality: 0 };
  const slope = points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0) / xx;
  const intercept = meanY - slope * meanX;
  const residual = points.reduce((sum, point) => sum + (point.y - intercept - slope * point.x) ** 2, 0);
  const total = points.reduce((sum, point) => sum + (point.y - meanY) ** 2, 0);
  const quality = total > 0 ? Math.max(0, Math.min(1, 1 - residual / total)) : 0;
  const initial = valid[0].scale;
  const latest = valid.at(-1)!.scale;
  const change = (latest - initial) / initial;

  if (change < -0.06 && slope > 0) return { seconds: null, trend: "receding", quality };
  if (change < 0.06 || slope >= 0) return { seconds: null, trend: "steady", quality };
  const currentInverseScale = intercept + slope * points.at(-1)!.x;
  const seconds = -currentInverseScale / slope;
  if (quality < 0.55 || !Number.isFinite(seconds) || seconds < 0.2 || seconds > 15) {
    return { seconds: null, trend: "measuring", quality };
  }
  return { seconds, trend: "approaching", quality };
}
