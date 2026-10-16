export type LocalTrial = { id: string; label: string; createdAt: string };
const key = "collision-risk-lab.trials.v1";
const changed = "collision-trials-changed";
const empty: LocalTrial[] = [];
let cachedText: string | null = null;
let cached: LocalTrial[] = empty;

export function localTrials(): LocalTrial[] {
  if (typeof window === "undefined") return empty;
  try {
    const text = localStorage.getItem(key);
    if (text === cachedText) return cached;
    const value: unknown = JSON.parse(text ?? "[]");
    cached = Array.isArray(value) ? value.filter((row): row is LocalTrial => Boolean(row) && typeof row === "object" && typeof row.id === "string" &&
      /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(row.id) && typeof row.label === "string" && typeof row.createdAt === "string").slice(0, 100) : empty;
    cachedText = text;
    return cached;
  } catch { return empty; }
}

export function rememberTrial(trial: LocalTrial): boolean {
  try {
    localStorage.setItem(key, JSON.stringify([trial, ...localTrials().filter((row) => row.id !== trial.id)].slice(0, 100)));
    window.dispatchEvent(new Event(changed));
    return true;
  } catch { return false; }
}

export function subscribeTrials(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(changed, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(changed, callback); };
}

export const serverTrials = () => empty;
