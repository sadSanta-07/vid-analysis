# Intelligent Video Analysis

A pipeline and live dashboard that analyzes a long video and produces **key frames, scene boundaries, a motion map, tracked objects, and a short summary video**.
Built for the SVP (Speech and Video Processing) project work.

## What it produces

| Required output | Method | Result files |
|---|---|---|
| Important frames | Sharpness + histogram clustering inside each scene | `outputs/keyframes/` |
| Scene boundaries | PySceneDetect `ContentDetector` (HSV content change) | `outputs/scenes/` |
| Motion map | Farneback dense optical flow with camera-motion compensation | `outputs/motion/` |
| Tracked objects | YOLO11 detection + ByteTrack, then fragment merging | `outputs/tracking/` |
| Short video summary | Scored 2-second windows, scene-coverage selection | `outputs/summaries/` |

## Pipeline

```
video -> scene detection -> keyframes
     \-> optical flow (motion map) ----\
     \-> YOLO + ByteTrack -> merge ------> window scoring -> summary video
                                  \-> Streamlit dashboard
```

## Methods

**Scene boundaries.** `ContentDetector` flags a cut when the frame-to-frame change in HSV color exceeds a threshold. Minimum scene length is 1 s to avoid flicker cuts.

**Key frames.** Frames are sampled every 0.5 s, skipping the first and last 0.3 s of a scene (transition frames). Each frame is scored on sharpness (variance of the Laplacian) and on closeness to a k-means cluster center of its color histogram. Longer scenes get more key frames (1, 2 or 3), chosen from different clusters so they show different moments.

**Motion map.** Farneback optical flow runs on every 3rd frame at 320 px width. The median flow vector of each frame is treated as camera motion and subtracted, so the remaining flow is object motion. Flow is not computed across scene cuts. Outputs are an accumulated heatmap, a motion-over-time chart and a peak-motion flow visualization.

**Tracking.** YOLO11s detects person, vehicle and animal classes. ByteTrack links detections into tracks. The tracker is reset at every scene cut and IDs are offset so they stay unique across scenes. A post-processing step merges fragments of the same class that are close in time and space (no overlap, no cut in between).

**Summary.** Each scene is cut into 2 s windows. Window score = 50% motion + 35% tracked-object activity + 15% scene length. The best window of each scene is taken first (if the length budget allows), then the rest is filled greedily with a penalty for repeating a scene. Clips are joined in time order with a scene and timestamp label.

## Results

**Development clip** (`video.mp4`, 1920x1080, 30 FPS, 61.4 s):

| Metric | Value |
|---|---|
| Scenes detected | 10 (identical at thresholds 27 and 18, so the cuts are hard cuts) |
| Key frames | 16 |
| Motion: mean / peak object motion | 6.4 / 40.4 px/s (peak at 8.8 s) |
| Motion: mean camera motion | 4.1 px/s |
| Raw track IDs | 73 (58 person, 9 motorcycle, 5 cow, 1 car) |
| Unique objects after merging | XX |
| Summary length | XX s (XX% of the video) |
| Tracking speed | about 14 sampled frames/s on CPU (`yolo11s`, stride 2) |

**Long video** (`long.mp4`, XX minutes): scenes XX, key frames XX, unique objects XX, summary XX s, total processing time XX min.

Screenshots are in `docs/screenshots/`.

## Limitations

- Track counts are **track IDs, not distinct individuals**. The merge step reduces fragmentation but is a heuristic and cannot re-identify someone who leaves the frame and returns much later.
- Motion is in pixels per second at 320 px width, not real-world speed.
- Scene detection finds hard cuts; slow dissolves and fades can be missed.
- The summary uses visual cues only. It does not use audio or semantics.
- The detector is a COCO-trained model, so objects outside its classes are not tracked.

## Run it

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt

# individual steps
python -m src.processors.scene_detection --video data/uploads/video.mp4
python -m src.processors.keyframes --video data/uploads/video.mp4
python -m src.processors.motion --video data/uploads/video.mp4
python -m src.tracking.tracker --video data/uploads/video.mp4 --stride 2
python -m src.tracking.cleanup
python -m src.processors.summary --video data/uploads/video.mp4 --stride 2

# dashboard
streamlit run app.py
```

## Structure

```
app.py                      Streamlit dashboard
src/processors/             scene_detection, keyframes, motion, summary
src/tracking/               tracker (YOLO + ByteTrack), cleanup (track merging)
src/utils/                  video_io, transcode
outputs/                    generated results
```

## Tech stack

Python 3.12, OpenCV, PySceneDetect, Ultralytics YOLO11 (ByteTrack), NumPy, pandas, Matplotlib, Plotly, Streamlit.