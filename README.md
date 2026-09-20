# Collision Risk Lab

A camera-only experiment for estimating the time until a visible object reaches a stationary laptop camera. It runs object detection in the browser; video is not uploaded or stored.

## Use it

1. Open the site and choose **Start camera**. Allow camera access in the browser.
2. Select the outline around a detected person or object.
3. Keep the laptop still and move the selected object slowly toward the camera, keeping it fully visible.

The app shows an estimated time to contact only when it sees a reasonably consistent approach. If the object is stationary, moves away, leaves the frame, or cannot be tracked reliably, it shows no countdown.

## How it works

The browser runs a local copy of MediaPipe Vision Tasks with EfficientDet-Lite0 to find objects. It tracks the selected detection between frames and records changes in the apparent size of its bounding box. For a fixed-size object approaching a stationary camera, inverse image size is approximately proportional to distance. A linear fit to that signal produces an approximate time to the camera plane.

This is **not** a measured distance, a physical collision detector, or a safety device. Rotating objects, a moving camera, occlusion, poor lighting, or changes in the detector's outline can make the estimate wrong. “Trend consistency” describes how well the recent measurements fit the simple model; it is not a calibrated confidence or accuracy score.

## Source

- `app/camera-lab.tsx`: camera permission, detector loading, tracking, and interface.
- `lib/approach.ts`: time-to-contact estimation from apparent size.
- `public/vision`: locally served detection model and runtime. MediaPipe Vision Tasks 1.0.1 uses the [Apache 2.0 license](public/vision/LICENSE.txt); the model comes from [Google's object detection guide](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector/web_js).

Run locally with `npm install` and `npm run dev`. The old simulation and benchmark screens and endpoint have been removed. Previously saved benchmark records remain in the site's database and have not been deleted.
