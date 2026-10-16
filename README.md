# Collision Risk Lab

Collision Risk Lab is a browser-based computer vision prototype for estimating time-to-contact from live camera video. It detects and tracks visible objects, outlines them in the camera view, and displays two separate estimates: projected overlap between objects in the image, and an object's approach toward the camera lens.

**Live demo:** [Open Collision Risk Lab](https://collision-risk-lab.vercel.app/)

## What it does

- Detects and outlines recognizable objects in a live webcam feed.
- Tracks object positions across frames to estimate motion.
- Estimates when a moving object's bounding box may overlap a stationary object's box in the 2D camera view.
- Estimates time-to-contact for a selected object moving toward the camera.
- Saves numeric lens-approach measurements and user-marked reference outcomes to Supabase.
- Uses verified reference trials to adjust a shared calibration factor for later lens-approach estimates.

## How the estimates work

### Object-to-object prediction

The app tracks each detected object's center and recent movement. It uses a robust median of pairwise velocities from recent frames to reduce the effect of a single inaccurate detection. When it has a sufficiently steady moving track and a separate stationary track, it projects their motion forward and estimates when their bounding boxes would overlap in the camera image.

This is a 2D image-plane prediction. It does not estimate depth, so two objects that overlap in the image may be at different physical distances and may not collide. The displayed path-fit value describes how consistently the recent motion follows a straight path; it is not a probability that a collision will occur.

### Approach toward the camera

For a selected object, the app measures its apparent size from the detected bounding box and smooths those measurements over a short time window. For an object with roughly constant physical size viewed by a stationary camera, inverse apparent size is approximately proportional to distance. The app fits a line to inverse size over time and uses the current trend to estimate time-to-contact.

The lens estimate is shown only when the object is getting larger and the recent measurements fit the approach model well enough. Stationary, receding, partly cropped, or inconsistently detected objects do not produce a reliable estimate. The displayed signal quality describes the fit to recent measurements, not a calibrated collision probability.

## Testing the live demo

1. Open the live demo over HTTPS and allow camera access.
2. Select an outlined object, or wait for the app to select a clearly detected object.
3. For the object-to-object estimate, keep two objects fully visible and separated. Move one steadily toward the other while keeping the second object still.
4. For the lens-approach estimate, keep the camera stationary and move the selected object steadily toward the camera. Keep it fully in frame and avoid rotating it significantly.
5. To contribute a calibration reference, start a measurement run and press **Mark reference reached** at the chosen safe reference point.

The app needs several frames of consistent motion before it shows an estimate. Results can change as detection and tracking update from frame to frame.

## Measurement storage and calibration

Camera video and object detection remain in the browser. The video is not uploaded or stored. The backend stores the selected object label, elapsed time, apparent-size measurements, raw lens time-to-contact estimates, signal quality values, and user-marked reference times.

When a reference is marked, the server compares the reference time with eligible saved estimates from that run. A run updates calibration only when it contains enough reliable samples. The app then combines verified trial corrections into a shared calibration factor used for later lens-approach estimates. Calibration changes this factor; it does not retrain the object detector or update the model weights. Calibration is shared across verified runs rather than personalized to an individual user.

## Technology

- Next.js, React, and TypeScript for the web application and API route.
- Ultralytics YOLO26n-seg ONNX model for in-browser object detection and segmentation outlines.
- Supabase Postgres for measurement and calibration records.
- Vercel for the live web deployment.

## Trial history and save diagnostics

The camera now shows acknowledged and pending sample counts. If an upload fails,
its samples remain in a per-run browser-memory queue, with their original IDs.
Use **Retry saving** and keep the recording tab open. The queue does not survive
closing or reloading the tab. A failed flush prevents the client from finishing
the trial, and a retried finish keeps the original reference timestamp.

**Trial history** opens in another tab so recording is not interrupted. It remembers
up to 100 trial links in this browser, not a public directory of every user's
trials. An existing trial can also be opened by its UUID. Older trials are not
automatically added to browser history; paste their ID from the database.
Treat a trial URL as a shareable link: this demo's detail endpoint uses the ID,
not a user login, to select a record. It does not add account-level ownership.

The detail page shows saved samples, raw lens predictions, a reference-time line,
mean absolute error against the user-marked reference, calibration eligibility,
and CSV export. Missing predictions stay missing; they are not converted to zero.
Error is evaluated on finite, nonnegative raw predictions strictly before the
reference. It is not physical-collision accuracy and does not measure whether the
shared display multiplier improved a particular historical trial. The calibration
report examines the latest 50 saved samples, matching the finish endpoint. It
counts each sample's first rejection reason, so rejection categories do not overlap.

Samples load in pages of 500. The graph, metrics, and export describe the loaded
samples; **Load earlier samples** expands that set. A partial CSV is named with
`-partial`. Refresh an active trial after it stops before comparing complete runs.

### Supabase setup

1. Configure server-only `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, as shown in
   `.env.example`. Never use a public/browser environment variable for the secret.
2. Apply `supabase/migrations/20260927000000_camera_measurements.sql` if the camera
   tables do not exist yet.
3. Apply `supabase/migrations/20261016000000_sample_retry_keys.sql` **before deploying
   this client/API version**. It adds a nullable client sample UUID and a unique
   index; existing samples remain intact. New uploads use duplicate-safe inserts,
   so retrying after a lost response does not create another copy of a sample.
4. Start the application and confirm that sample counts increase, then finish a
   reference trial and inspect its history page.

The current camera backend uses Supabase directly. `npm run db:generate` produces
SQLite/D1 migrations from `db/schema.ts`; it does **not** apply either Supabase file.

### Read-only trial endpoint

`GET /api/trials/<uuid>?offset=0&limit=500` returns the run, a sample page ordered
newest first, `hasMore`, and `nextOffset`. Limits of 1-500 and offsets of 0-100000
are accepted. There is no anonymous endpoint listing all runs.

### Checks

```sh
npm ci
npm test
npm run lint
npm run build
```

`npm test` uses Node's built-in test runner and the existing TypeScript compiler.
It covers calibration decisions, reference error calculations, missing values,
batch retention, concurrent flushes, duplicate-safe retries, finish retries,
history pagination, request validation, and safe database errors. Database HTTP
calls are simulated; these tests do not certify a live Supabase deployment or
camera accuracy. Expected failure scenarios print safe database error metadata.

For a restricted Windows environment where native config resolution or Turbopack
fails with a path permission error, the equivalent build can be checked with:

```sh
npx next build --webpack --experimental-next-config-strip-types
```

This is a local tooling workaround, not a requirement for Vercel deployments.

## Limitations and safety

These values are visual estimates, not measured physical distances or guaranteed collision warnings. The lens estimate assumes a stationary camera and an object whose apparent size changes mainly because it moves closer. Changes in pose, rotation, occlusion, lighting, or detection quality can distort that signal. The object-to-object estimate uses 2D image overlap and assumes recent motion continues steadily. Neither estimate accounts for full 3D motion or object intent.

Use the demo only for controlled experiments. It is not a vehicle system, a certified collision detector, or a safety device.
