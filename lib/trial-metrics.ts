export type TrialRun = {
  id: string;
  created_at: string;
  object_label: string;
  status: "active" | "stopped" | "completed" | "verified";
  reference_elapsed_ms: number | null;
  calibration_ratio: number | null;
};

export type TrialSample = {
  id: number;
  elapsed_ms: number;
  scale: number;
  raw_ttc: number | null;
  quality: number;
};

export type TrialPage = {
  run: TrialRun;
  samples: TrialSample[];
  hasMore: boolean;
  nextOffset: number;
};

export function referenceRemaining(sample: TrialSample, referenceMs: number | null): number | null {
  if (referenceMs === null || !Number.isFinite(referenceMs) || !Number.isFinite(sample.elapsed_ms)) return null;
  const remaining = (referenceMs - sample.elapsed_ms) / 1000;
  return remaining > 0 ? remaining : null;
}

export function trialMetrics(samples: TrialSample[], referenceMs: number | null) {
  const errors = samples.flatMap((sample) => {
    const actual = referenceRemaining(sample, referenceMs);
    return actual !== null && sample.raw_ttc !== null && Number.isFinite(sample.raw_ttc) && sample.raw_ttc >= 0
      ? [Math.abs(sample.raw_ttc - actual)] : [];
  });
  return {
    total: samples.length,
    predictions: samples.filter((sample) => sample.raw_ttc !== null && Number.isFinite(sample.raw_ttc)).length,
    compared: errors.length,
    meanAbsoluteError: errors.length ? errors.reduce((sum, error) => sum + error, 0) / errors.length : null,
  };
}

/** Only numeric values and the validated run UUID are exported, never an object label. */
export function trialCsv(run: TrialRun, samples: TrialSample[]): string {
  const rows = [...samples].sort((a, b) => a.elapsed_ms - b.elapsed_ms).map((sample) => {
    const remaining = referenceRemaining(sample, run.reference_elapsed_ms);
    const prediction = sample.raw_ttc !== null && Number.isFinite(sample.raw_ttc) ? sample.raw_ttc : null;
    return [run.id, sample.elapsed_ms, sample.scale, prediction ?? "", sample.quality, remaining ?? "",
      remaining !== null && prediction !== null ? Math.abs(prediction - remaining) : ""].join(",");
  });
  return ["run_id,elapsed_ms,scale,raw_ttc_seconds,quality,reference_remaining_seconds,absolute_error_seconds", ...rows].join("\r\n");
}
