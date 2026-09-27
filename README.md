# Collision Risk Lab

A browser-based computer-vision project that estimates time-to-contact for a selected object approaching a stationary camera.

## Live Demo

[Open Collision Risk Lab](https://collision-risk-lab.vercel.app/)

## Try it

1. Open the live demo and allow camera access.
2. Select a detected object to track.
3. Keep the camera stationary and move the selected object toward it.
4. Watch the estimated time-to-contact. If using a reference trial, mark when the object reaches the camera so the app can record the outcome for calibration.

## How it works

Object detection and tracking run in the browser using a locally served model. The app estimates approach speed from changes in the selected object's apparent size, then fits that trend to estimate time-to-contact. A server API stores numeric measurements and user-marked reference outcomes in Supabase so calibration can be adjusted from completed trials.

## Privacy and limitations

Camera video is processed in the browser and is not uploaded or stored. Numeric measurements, object labels, and reference outcomes are sent to the backend for persistence and calibration. The estimate is approximate—not a measured distance, certified collision detector, or safety device. A moving camera, occlusion, poor lighting, target rotation, or inconsistent detection can affect the result.
