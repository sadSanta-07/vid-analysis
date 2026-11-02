"""Re-encode the tracked and summary videos to H.264 so that browsers can play them.

Run from the project root:   python -m tools.prep_web
"""
from pathlib import Path

from src.utils.transcode import to_h264

ROOT = Path(__file__).resolve().parent.parent

for d in sorted(ROOT.glob("outputs*")):
    pairs = [(d / "tracking" / "tracked.mp4", d / "tracking" / "tracked_h264.mp4"),
             (d / "summaries" / "summary.mp4", d / "summaries" / "summary_h264.mp4")]
    for src, dst in pairs:
        if src.exists() and (not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime):
            print("Encoding", dst.relative_to(ROOT))
            print("  done" if to_h264(src, dst) else "  FAILED")
print("Finished")