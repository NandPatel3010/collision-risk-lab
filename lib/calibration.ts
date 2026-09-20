export type CalibrationSample = { elapsedMs: number; rawTtc: number | null; quality: number };

/** A trial teaches us only if the user marks a repeatable reference point. */
export function trialCalibration(samples: CalibrationSample[], referenceElapsedMs: number): number | null {
  const ratios = samples.flatMap(({ elapsedMs, rawTtc, quality }) => {
    const actual = (referenceElapsedMs - elapsedMs) / 1000;
    if (rawTtc === null || !Number.isFinite(rawTtc) || rawTtc <= 0 || quality < 0.65 || actual < 0.7 || actual > 8) return [];
    return [actual / rawTtc];
  }).filter((ratio) => ratio >= 0.35 && ratio <= 2.5).sort((a, b) => a - b);
  if (ratios.length < 3) return null;
  return ratios[Math.floor(ratios.length / 2)];
}

export function combinedCalibration(ratios: number[]): number {
  const valid = ratios.filter((ratio) => Number.isFinite(ratio) && ratio >= 0.35 && ratio <= 2.5).sort((a, b) => a - b);
  if (!valid.length) return 1;
  const middle = Math.floor(valid.length / 2);
  return Math.max(0.5, Math.min(1.8, valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2));
}
