export type CalibrationSample = { elapsedMs: number; rawTtc: number | null; quality: number };

export type CalibrationAnalysis = {
  total: number;
  eligible: number;
  rejected: { noPrediction: number; lowQuality: number; outsideWindow: number; outsideRatio: number };
  ratio: number | null;
  message: string;
};

/** Report each sample's first rejection reason without changing the original thresholds. */
export function analyzeCalibration(samples: CalibrationSample[], referenceElapsedMs: number): CalibrationAnalysis {
  const rejected = { noPrediction: 0, lowQuality: 0, outsideWindow: 0, outsideRatio: 0 };
  const ratios: number[] = [];
  for (const { elapsedMs, rawTtc, quality } of samples) {
    const actual = (referenceElapsedMs - elapsedMs) / 1000;
    if (rawTtc === null || !Number.isFinite(rawTtc) || rawTtc <= 0) rejected.noPrediction++;
    else if (!Number.isFinite(quality) || quality < 0.65) rejected.lowQuality++;
    else if (!Number.isFinite(actual) || actual < 0.7 || actual > 8) rejected.outsideWindow++;
    else if (actual / rawTtc < 0.35 || actual / rawTtc > 2.5) rejected.outsideRatio++;
    else ratios.push(actual / rawTtc);
  }
  ratios.sort((a, b) => a - b);
  // Preserve the existing upper-middle selection for an even-sized trial.
  const ratio = ratios.length < 3 ? null : ratios[Math.floor(ratios.length / 2)];
  const message = ratio !== null
    ? `Calibration accepted: ${ratios.length} eligible samples; trial correction ${ratio.toFixed(3)}.`
    : samples.length === 0
      ? "No measurements were saved for this trial. Check recording status and keep the object fully visible."
      : `Calibration unchanged: ${ratios.length} of ${samples.length} samples eligible; at least 3 required. Rejected: ${rejected.noPrediction} without a prediction, ${rejected.lowQuality} below 65% quality, ${rejected.outsideWindow} outside 0.7-8 seconds before the reference, ${rejected.outsideRatio} outside the correction range.`;
  return { total: samples.length, eligible: ratios.length, rejected, ratio, message };
}

/** A trial teaches us only if the user marks a repeatable reference point. */
export function trialCalibration(samples: CalibrationSample[], referenceElapsedMs: number): number | null {
  return analyzeCalibration(samples, referenceElapsedMs).ratio;
}

export function combinedCalibration(ratios: number[]): number {
  const valid = ratios.filter((ratio) => Number.isFinite(ratio) && ratio >= 0.35 && ratio <= 2.5).sort((a, b) => a - b);
  if (!valid.length) return 1;
  const middle = Math.floor(valid.length / 2);
  return Math.max(0.5, Math.min(1.8, valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2));
}
