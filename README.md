# Collision Risk Lab

A software-only collision prediction experiment with two modes. Explore four simulated traffic scenarios and run repeatable test batches on the server, or use a laptop webcam to estimate when a selected object moving toward the camera would reach its plane. Benchmark results are stored in Cloudflare D1 and can be revisited from the dashboard. Webcam frames stay on the device and are not saved.

This is an educational simulation, not a road-safety device or a claim of real-world autonomous-driving performance.

## What is implemented

- Interactive top-down playback with projected vehicle paths, a warning marker, and a gap trace.
- Live controls for vehicle A speed, prediction horizon, and safety margin.
- A server-side batch runner for 10–500 seeded scenario variations.
- Saved run history, timely-warning rate, false-alarm rate, precision, lead time, and processing time.
- Input validation on the API and reproducible results for the same seed/settings.
- A separate webcam mode with on-device object detection, object selection, and a live approach estimate.

## How the predictor works

For vehicles at positions `pA` and `pB` with velocities `vA` and `vB`, compute relative position `r = pB - pA` and relative velocity `u = vB - vA`. The closest-approach time within horizon `H` is `clamp(-dot(r,u) / dot(u,u), 0, H)` (zero when relative speed is zero). The projected gap is distance at that time minus both vehicle radii. A warning fires when the gap is at or below the chosen safety margin.

The predictor assumes current velocities continue unchanged. The simulation includes a braking event and a lane-change event that violate this assumption, so those cases can produce late warnings. The benchmark counts a collision as *caught* only when the warning arrives at least one second before contact. A collision discovered too late counts as missed. These rules are deliberate and visible in the UI.

## Webcam approach estimate

The browser loads a local copy of MediaPipe Vision Tasks and EfficientDet-Lite0, then asks for camera access. Select an outlined object. The app samples its detected bounding-box area over roughly 1.8 seconds and fits a line to inverse apparent size. If the object grows consistently and the fit is adequate, the ratio of current inverse size to its rate of decrease gives an approximate time to the camera plane. A steady, receding, cropped, or lost object produces no countdown. Stop camera releases the media stream, as does leaving webcam mode.

This estimate assumes a stationary camera, a roughly fixed-size rigid object, and reasonably constant approach speed. Camera movement, object rotation, changing detector boxes, occlusion, and sideward motion can make it wrong. It does not measure distance in metres, detect physical contact, or establish automotive safety performance. The simulation benchmark metrics do **not** measure webcam accuracy.

## Project structure

- `lib/simulation.ts`: scenarios, vehicle motion, collision checks, closest-approach prediction.
- `lib/benchmark.ts`: seeded randomized runs and metric calculation.
- `app/page.tsx`: live scenario and prediction trace.
- `app/benchmark-panel.tsx`: backend test controls and results dashboard.
- `app/camera-lab.tsx` and `lib/approach.ts`: webcam detector, single-object tracking, and time-to-contact fit.
- `app/api/benchmarks/route.ts`: validated benchmark API.
- `db/schema.ts` and `db/runs.ts`: D1 schema and saved-run access.

MediaPipe Vision Tasks 1.0.1 and its WebAssembly assets are served from `public/vision` under the [Apache 2.0 license](public/vision/LICENSE.txt). The EfficientDet-Lite0 object detection model is supplied by [Google's MediaPipe object detector example](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector/web_js).

## Run locally

Install dependencies with `npm install`, then run `npm run db:generate` if migrations are not present. Start the app with `npm run dev`. To prepare a fresh local D1 database, first run `npm run build`, then apply the migration:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_past_nocturne.sql
```

After that, the dashboard's **Run test suite** button runs and saves benchmarks. The API is `GET /api/benchmarks` for recent runs and `POST /api/benchmarks` with JSON `count`, `horizon`, `margin`, and `seed` to run a suite.

## Limitations and possible next steps

The vehicles are circles in 2D, motion is simplified, and the simulation predictor receives positions and velocities directly. The webcam mode is a separate, single-object approach experiment; it does not feed camera detections into the 2D traffic predictor. A useful next step is collecting labeled approach videos and measuring webcam estimate error, false alerts, and latency. Do not describe this version as a real-vehicle collision avoidance system.
