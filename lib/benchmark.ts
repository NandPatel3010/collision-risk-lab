import { isCollision, positionsAt, predict, SCENARIOS, type Scenario } from "./simulation";

export type BenchmarkOptions = { count: number; horizon: number; margin: number; seed: number };
export type BenchmarkResult = BenchmarkOptions & {
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  lateWarning: number;
  collisionRate: number;
  detectionRate: number;
  falseAlarmRate: number;
  precision: number;
  meanLeadTime: number | null;
  processingMs: number;
};

function randomGenerator(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function vary(base: Scenario, random: () => number): Scenario {
  return {
    ...base,
    vehicles: base.vehicles.map((vehicle) => ({
      ...vehicle,
      x: vehicle.x + (random() - 0.5) * 90,
      y: vehicle.y + (random() - 0.5) * 45,
      vx: vehicle.vx === 0 ? 0 : Math.max(8, vehicle.vx * (0.78 + random() * 0.44)),
      vy: vehicle.vy * (0.78 + random() * 0.44),
      eventTime: vehicle.eventTime === undefined ? undefined : vehicle.eventTime + (random() - 0.5) * 1.3,
      ax: vehicle.ax === undefined ? undefined : vehicle.ax * (0.75 + random() * 0.5),
    })),
  };
}

export function runBenchmark(options: BenchmarkOptions): BenchmarkResult {
  const started = performance.now();
  const random = randomGenerator(options.seed);
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;
  let lateWarning = 0;
  let leadSum = 0;

  for (let i = 0; i < options.count; i++) {
    const scenario = vary(SCENARIOS[i % SCENARIOS.length], random);
    let warningAt: number | null = null;
    let collisionAt: number | null = null;
    for (let step = 0; step <= Math.ceil(scenario.duration / 0.05); step++) {
      const seconds = Math.min(step * 0.05, scenario.duration);
      const vehicles = positionsAt(scenario, seconds);
      if (warningAt === null && predict(vehicles, options.horizon, options.margin).risk) warningAt = seconds;
      if (isCollision(vehicles)) { collisionAt = seconds; break; }
    }
    if (collisionAt !== null && warningAt !== null && collisionAt - warningAt >= 1) { truePositive++; leadSum += collisionAt - warningAt; }
    else if (collisionAt !== null) { falseNegative++; if (warningAt !== null) lateWarning++; }
    else if (warningAt !== null) falsePositive++;
    else trueNegative++;
  }

  const collisions = truePositive + falseNegative;
  const safe = trueNegative + falsePositive;
  return {
    ...options, truePositive, falsePositive, trueNegative, falseNegative, lateWarning,
    collisionRate: collisions / options.count,
    detectionRate: collisions ? truePositive / collisions : 0,
    falseAlarmRate: safe ? falsePositive / safe : 0,
    precision: truePositive + falsePositive + lateWarning ? truePositive / (truePositive + falsePositive + lateWarning) : 0,
    meanLeadTime: truePositive ? leadSum / truePositive : null,
    processingMs: performance.now() - started,
  };
}
