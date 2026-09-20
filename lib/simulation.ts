export type ScenarioId = "crossing" | "rear-end" | "near-miss" | "merge";

export type Vehicle = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax?: number;
  ay?: number;
  eventTime?: number;
  radius: number;
  color: string;
};

export type Scenario = {
  id: ScenarioId;
  name: string;
  detail: string;
  duration: number;
  vehicles: Vehicle[];
};

export type Prediction = {
  risk: boolean;
  gap: number;
  seconds: number;
  pair: string;
  closestX: number;
  closestY: number;
};

export const SCENARIOS: Scenario[] = [
  {
    id: "crossing",
    name: "Crossing paths",
    detail: "Two vehicles approach the same intersection.",
    duration: 6,
    vehicles: [
      { id: "A", x: 150, y: 250, vx: 86, vy: 0, radius: 16, color: "#37d6c2" },
      { id: "B", x: 450, y: 24, vx: 0, vy: 65, radius: 16, color: "#ffb15a" },
    ],
  },
  {
    id: "rear-end",
    name: "Sudden slowdown",
    detail: "A faster vehicle closes on slower traffic.",
    duration: 8,
    vehicles: [
      { id: "A", x: 65, y: 250, vx: 88, vy: 0, radius: 16, color: "#37d6c2" },
      { id: "B", x: 365, y: 250, vx: 30, vy: 0, ax: -18, eventTime: 2.2, radius: 16, color: "#ffb15a" },
    ],
  },
  {
    id: "near-miss",
    name: "Near miss",
    detail: "Close paths that should not be mistaken for a collision.",
    duration: 6,
    vehicles: [
      { id: "A", x: 150, y: 250, vx: 85, vy: 0, radius: 16, color: "#37d6c2" },
      { id: "B", x: 450, y: 20, vx: 0, vy: 85, radius: 16, color: "#ffb15a" },
    ],
  },
  {
    id: "merge",
    name: "Highway merge",
    detail: "A vehicle joins a lane already in use.",
    duration: 7,
    vehicles: [
      { id: "A", x: 170, y: 205, vx: 78, vy: 0, ay: 45, eventTime: 2.1, radius: 16, color: "#37d6c2" },
      { id: "B", x: 296, y: 250, vx: 36, vy: 0, radius: 16, color: "#ffb15a" },
    ],
  },
];

export function positionsAt(scenario: Scenario, seconds: number): Vehicle[] {
  return scenario.vehicles.map((v) => {
    const acceleratedFor = Math.max(0, seconds - (v.eventTime ?? 0));
    const ax = v.ax ?? 0;
    const ay = v.ay ?? 0;
    const xAccelTime = ax < 0 && v.vx > 0 ? Math.min(acceleratedFor, -v.vx / ax) : acceleratedFor;
    const yAccelTime = ay < 0 && v.vy > 0 ? Math.min(acceleratedFor, -v.vy / ay) : acceleratedFor;
    return {
      ...v,
      x: v.x + v.vx * Math.min(seconds, v.eventTime ?? 0) + v.vx * xAccelTime + 0.5 * ax * xAccelTime * xAccelTime,
      y: v.y + v.vy * Math.min(seconds, v.eventTime ?? 0) + v.vy * yAccelTime + 0.5 * ay * yAccelTime * yAccelTime,
      vx: v.vx + ax * xAccelTime,
      vy: v.vy + ay * yAccelTime,
    };
  });
}

export function predict(vehicles: Vehicle[], horizon = 4, margin = 8): Prediction {
  let best: Prediction = {
    risk: false,
    gap: Number.POSITIVE_INFINITY,
    seconds: 0,
    pair: "",
    closestX: 0,
    closestY: 0,
  };

  for (let i = 0; i < vehicles.length; i++) {
    for (let j = i + 1; j < vehicles.length; j++) {
      const a = vehicles[i];
      const b = vehicles[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dvx = b.vx - a.vx;
      const dvy = b.vy - a.vy;
      const speedSq = dvx * dvx + dvy * dvy;
      const closestTime = speedSq < 0.0001
        ? 0
        : Math.max(0, Math.min(horizon, -(dx * dvx + dy * dvy) / speedSq));
      const gap = Math.hypot(dx + dvx * closestTime, dy + dvy * closestTime) - a.radius - b.radius;

      if (gap < best.gap) {
        best = {
          risk: gap <= margin,
          gap,
          seconds: closestTime,
          pair: a.id + " / " + b.id,
          closestX: (a.x + a.vx * closestTime + b.x + b.vx * closestTime) / 2,
          closestY: (a.y + a.vy * closestTime + b.y + b.vy * closestTime) / 2,
        };
      }
    }
  }
  return best;
}

export function isCollision(vehicles: Vehicle[]): boolean {
  for (let i = 0; i < vehicles.length; i++) {
    for (let j = i + 1; j < vehicles.length; j++) {
      const a = vehicles[i];
      const b = vehicles[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) <= a.radius + b.radius) return true;
    }
  }
  return false;
}
