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

## Limitations and safety

These values are visual estimates, not measured physical distances or guaranteed collision warnings. The lens estimate assumes a stationary camera and an object whose apparent size changes mainly because it moves closer. Changes in pose, rotation, occlusion, lighting, or detection quality can distort that signal. The object-to-object estimate uses 2D image overlap and assumes recent motion continues steadily. Neither estimate accounts for full 3D motion or object intent.

Use the demo only for controlled experiments. It is not a vehicle system, a certified collision detector, or a safety device.
