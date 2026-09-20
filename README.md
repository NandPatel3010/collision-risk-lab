# Collision Risk Lab

A software-only, 2D collision prediction experiment. Explore four traffic scenarios, adjust the live predictor, then run repeatable batches of randomized scenarios on the server. Benchmark results are stored in Cloudflare D1 and can be revisited from the dashboard.

This is an educational simulation, not a road-safety device or a claim of real-world autonomous-driving performance.

## What is implemented

- Interactive top-down playback with projected vehicle paths, a warning marker, and a gap trace.
- Live controls for vehicle A speed, prediction horizon, and safety margin.
- A server-side batch runner for 10–500 seeded scenario variations.
- Saved run history, timely-warning rate, false-alarm rate, precision, lead time, and processing time.
- Input validation on the API and reproducible results for the same seed/settings.

## How the predictor works

For vehicles at positions `pA` and `pB` with velocities `vA` and `vB`, compute relative position `r = pB - pA` and relative velocity `u = vB - vA`. The closest-approach time within horizon `H` is `clamp(-dot(r,u) / dot(u,u), 0, H)` (zero when relative speed is zero). The projected gap is distance at that time minus both vehicle radii. A warning fires when the gap is at or below the chosen safety margin.

The predictor assumes current velocities continue unchanged. The simulation includes a braking event and a lane-change event that violate this assumption, so those cases can produce late warnings. The benchmark counts a collision as *caught* only when the warning arrives at least one second before contact. A collision discovered too late counts as missed. These rules are deliberate and visible in the UI.

## Project structure

- `lib/simulation.ts`: scenarios, vehicle motion, collision checks, closest-approach prediction.
- `lib/benchmark.ts`: seeded randomized runs and metric calculation.
- `app/page.tsx`: live scenario and prediction trace.
- `app/benchmark-panel.tsx`: backend test controls and results dashboard.
- `app/api/benchmarks/route.ts`: validated benchmark API.
- `db/schema.ts` and `db/runs.ts`: D1 schema and saved-run access.

## Run locally

Install dependencies with `npm install`, then run `npm run db:generate` if migrations are not present. Start the app with `npm run dev`. To prepare a fresh local D1 database, first run `npm run build`, then apply the migration:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_past_nocturne.sql
```

After that, the dashboard's **Run test suite** button runs and saves benchmarks. The API is `GET /api/benchmarks` for recent runs and `POST /api/benchmarks` with JSON `count`, `horizon`, `margin`, and `seed` to run a suite.

## Limitations and possible next steps

The vehicles are circles in 2D, motion is simplified, and the predictor receives simulated positions and velocities directly—it does not perceive camera footage. A meaningful next step would be to feed it noisy position estimates and compare the impact on warning quality. Do not describe this version as a vision-based or real-vehicle collision avoidance system.
