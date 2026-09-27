# Collision Risk Lab

A camera-only experiment for estimating the time until a visible object reaches a stationary laptop camera. Object detection runs in the browser; video is not uploaded or stored. The app saves numeric camera measurements and calibration results through a server-side API to Supabase Postgres.

## Run locally

1. Install dependencies with `pnpm install` (or `npm install`).
2. Copy `.env.example` to `.env.local` and fill in `SUPABASE_URL` and `SUPABASE_SECRET_KEY` from your Supabase project.
3. Run the SQL in `supabase/migrations/20260927000000_camera_measurements.sql` in the Supabase SQL Editor.
4. Start the app with `pnpm dev` (or `npm run dev`).

## Deploy to Vercel

1. Create a Supabase project and run the SQL migration above.
2. Import the private GitHub repository into Vercel. Vercel detects the Next.js app and uses `pnpm build` or `npm run build`.
3. In the Vercel project settings, add `SUPABASE_URL` and `SUPABASE_SECRET_KEY` for Production and Preview deployments, then redeploy.

`SUPABASE_SECRET_KEY` is used only by the server API route. Never rename it with a `NEXT_PUBLIC_` prefix or commit its real value. The database tables have row-level security enabled and are not accessible to browser/anonymous roles; reads and writes pass through `/api/camera`.

## How it works

The browser runs object detection with a locally served model. It tracks the selected detection and records changes in the apparent size of its bounding box. A linear fit to inverse image size produces an approximate time to contact. The API stores object labels, numeric samples, and user-marked reference outcomes so verified trials can update the app's calibration factor. Video remains on the device.

This is **not** a measured distance, a physical collision detector, or a safety device. Rotating objects, a moving camera, occlusion, poor lighting, or changes in the detector's outline can make the estimate wrong. “Trend consistency” describes how well recent measurements fit the simple model; it is not a calibrated confidence or accuracy score.

## Source

- `app/camera-lab.tsx`: camera permission, detector, tracking, and interface.
- `app/api/camera/route.ts`: validated measurement API route.
- `lib/approach.ts`: time-to-contact estimation from apparent size.
- `lib/calibration.ts`: calibration from user-marked reference points.
- `supabase/migrations/20260927000000_camera_measurements.sql`: database tables and access controls.
- `public/models`: locally served object detection model.
