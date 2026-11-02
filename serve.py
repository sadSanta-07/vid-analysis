"""
Local web backend for Intelligent Video Analysis.

Run from the project root:
    python serve.py
    python serve.py 8000
"""

import json
import os
import re
import sys
import time
import threading
import subprocess

from pathlib import Path
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from email.parser import BytesParser
from email.policy import default
from urllib.parse import urlparse

from src.utils.transcode import to_h264


ROOT = Path(__file__).resolve().parent
UPLOADS = ROOT / "data" / "uploads"
OUTPUTS = ROOT / "outputs"

VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
MAX_UPLOAD_SIZE = 2 * 1024 * 1024 * 1024

UPLOADS.mkdir(parents=True, exist_ok=True)

JOB_LOCK = threading.Lock()

JOB = {
    "running": False,
    "completed": False,
    "success": False,
    "stage": None,
    "stage_index": 0,
    "total_stages": 6,
    "progress": 0,
    "message": "Waiting for a video",
    "error": None,
    "logs": [],
    "started_at": None,
    "finished_at": None,
}


def json_response(handler, payload, status=200):
    body = json.dumps(payload).encode("utf-8")

    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


def add_log(message):
    with JOB_LOCK:
        JOB["logs"].append(str(message))
        JOB["logs"] = JOB["logs"][-150:]


def get_results():
    results = []

    for folder in sorted(ROOT.glob("outputs*")):
        if not folder.is_dir():
            continue

        scenes = folder / "scenes" / "scenes.csv"
        if not scenes.exists():
            continue

        source_file = folder / "source.txt"
        source = None

        if source_file.exists():
            source = source_file.read_text(
                encoding="utf-8"
            ).strip()

        results.append({
            "name": folder.name,
            "source": source,
        })

    return results


def get_videos():
    return sorted(
        file.name
        for file in UPLOADS.iterdir()
        if file.is_file()
        and file.suffix.lower() in VIDEO_EXTENSIONS
    )


def update_job(**values):
    with JOB_LOCK:
        JOB.update(values)


def run_stage(label, command, index):
    update_job(
        stage=label,
        stage_index=index,
        progress=round(((index - 1) / 6) * 100),
        message=f"Running: {label}",
    )

    add_log(f"\n{'=' * 55}")
    add_log(f"Stage {index}/6: {label}")
    add_log(f"{'=' * 55}")

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"

    existing_pythonpath = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = (
        str(ROOT)
        if not existing_pythonpath
        else str(ROOT) + os.pathsep + existing_pythonpath
    )

    process = subprocess.run(
        [sys.executable, "-u", "-m", *command],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    output = (process.stdout or "") + "\n" + (process.stderr or "")

    for line in output.splitlines()[-100:]:
        add_log(line)

    if process.returncode != 0:
        raise RuntimeError(
            f"{label} failed with exit code {process.returncode}.\n"
            f"{output[-5000:]}"
        )

    update_job(
        progress=round((index / 6) * 100),
        message=f"Completed: {label}",
    )


def pipeline_worker(video_name, settings):
    video_path = UPLOADS / video_name

    try:
        update_job(
            running=True,
            completed=False,
            success=False,
            stage="Starting",
            stage_index=0,
            progress=0,
            message="Preparing pipeline...",
            error=None,
            logs=[],
            started_at=datetime.now().isoformat(),
            finished_at=None,
        )

        if not video_path.exists():
            raise FileNotFoundError(f"Video not found: {video_name}")

        OUTPUTS.mkdir(parents=True, exist_ok=True)

        # These are the same six stages used by app.py.
        stages = [
            (
                "Scene detection",
                [
                    "src.processors.scene_detection",
                    "--video", str(video_path),
                    "--threshold", str(settings["threshold"]),
                    "--min_len", str(settings["min_scene_length"]),
                ],
            ),
            (
                "Keyframe extraction",
                [
                    "src.processors.keyframes",
                    "--video", str(video_path),
                    "--step", str(settings["keyframe_step"]),
                ],
            ),
            (
                "Motion analysis",
                [
                    "src.processors.motion",
                    "--video", str(video_path),
                ],
            ),
            (
                "Object tracking",
                [
                    "src.tracking.tracker",
                    "--video", str(video_path),
                    "--model", settings["model"],
                    "--stride", str(settings["tracking_stride"]),
                    "--conf", str(settings["confidence"]),
                ],
            ),
            (
                "Track cleanup",
                [
                    "src.tracking.cleanup",
                ],
            ),
            (
                "Summary generation",
                [
                    "src.processors.summary",
                    "--video", str(video_path),
                    "--stride", str(settings["tracking_stride"]),
                ] + (
                    ["--target", str(settings["summary_length"])]
                    if settings["summary_length"] is not None
                    else []
                ),
            ),
        ]

        for index, (label, command) in enumerate(stages, start=1):
            run_stage(label, command, index)

        # Keep track of which video generated these results.
        (OUTPUTS / "source.txt").write_text(
            video_name,
            encoding="utf-8",
        )

        # Convert tracked video to browser-compatible H.264.
        tracked = OUTPUTS / "tracking" / "tracked.mp4"
        tracked_h264 = OUTPUTS / "tracking" / "tracked_h264.mp4"

        if tracked.exists():
            update_job(
                stage="Video encoding",
                message="Preparing tracked video for browser playback...",
            )

            if not to_h264(tracked, tracked_h264):
                add_log("Warning: tracked video H.264 conversion failed.")

        update_job(
            running=False,
            completed=True,
            success=True,
            stage="Complete",
            stage_index=6,
            progress=100,
            message="Analysis completed successfully.",
            finished_at=datetime.now().isoformat(),
        )

    except Exception as exc:
        add_log(f"ERROR: {exc}")

        update_job(
            running=False,
            completed=True,
            success=False,
            stage="Failed",
            message="Pipeline failed.",
            error=str(exc),
            finished_at=datetime.now().isoformat(),
        )


def validate_settings(data):
    allowed_models = {
        "yolo11n.pt",
        "yolo11s.pt",
        "yolo11m.pt",
    }

    model = data.get("model", "yolo11s.pt")

    if model not in allowed_models:
        raise ValueError("Unsupported YOLO model.")

    def number(key, default, low, high):
        value = float(data.get(key, default))

        if not low <= value <= high:
            raise ValueError(
                f"{key} must be between {low} and {high}."
            )

        return value

    stride = int(data.get("tracking_stride", 2))

    if not 1 <= stride <= 6:
        raise ValueError("Tracking stride must be between 1 and 6.")

    summary_length = data.get("summary_length")

    if summary_length in (None, "", "auto"):
        summary_length = None
    else:
        summary_length = float(summary_length)

        if not 5 <= summary_length <= 120:
            raise ValueError(
                "Summary length must be between 5 and 120 seconds."
            )

    return {
        "threshold": number("threshold", 27, 10, 50),
        "min_scene_length": number(
            "min_scene_length", 1, 0.5, 5
        ),
        "keyframe_step": number(
            "keyframe_step", 0.5, 0.25, 2
        ),
        "tracking_stride": stride,
        "confidence": number("confidence", 0.3, 0.1, 0.8),
        "model": model,
        "summary_length": summary_length,
    }


class Handler(SimpleHTTPRequestHandler):

    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".csv": "text/csv",
        ".json": "application/json",
        ".html": "text/html",
        ".mp4": "video/mp4",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
    }

    range_left = None

    def __init__(self, *args, **kwargs):
        super().__init__(
            *args,
            directory=str(ROOT),
            **kwargs,
        )

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/":
            self.send_response(302)
            self.send_header("Location", "/web/index.html")
            self.end_headers()
            return

        if path == "/api/results":
            json_response(self, {
                "results": get_results(),
                "videos": get_videos(),
            })
            return

        if path == "/api/status":
            with JOB_LOCK:
                snapshot = dict(JOB)

            json_response(self, snapshot)
            return

        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path

        if path == "/api/upload":
            self.handle_upload()
            return

        if path == "/api/run":
            self.handle_run()
            return

        json_response(
            self,
            {"error": "Unknown API endpoint."},
            404,
        )

    def handle_upload(self):
        content_type = self.headers.get("Content-Type", "")

        if "multipart/form-data" not in content_type:
            return json_response(
                self,
                {"error": "Expected multipart/form-data."},
                400,
            )

        length = int(self.headers.get("Content-Length", 0))

        if length <= 0 or length > MAX_UPLOAD_SIZE:
            return json_response(
                self,
                {"error": "Invalid upload size."},
                413,
            )

        body = self.rfile.read(length)

        message = BytesParser(policy=default).parsebytes(
            (
                f"Content-Type: {content_type}\r\n"
                "MIME-Version: 1.0\r\n\r\n"
            ).encode() + body
        )

        uploaded = None

        for part in message.iter_parts():
            if part.get_content_disposition() != "form-data":
                continue

            if part.get_param("name", header="content-disposition") != "file":
                continue

            uploaded = part
            break

        if uploaded is None:
            return json_response(
                self,
                {"error": "No file field was uploaded."},
                400,
            )

        original_name = uploaded.get_filename() or "video.mp4"
        filename = Path(original_name).name
        suffix = Path(filename).suffix.lower()

        if suffix not in VIDEO_EXTENSIONS:
            return json_response(
                self,
                {"error": "Unsupported video format."},
                400,
            )

        data = uploaded.get_payload(decode=True)

        if not data:
            return json_response(
                self,
                {"error": "Uploaded file is empty."},
                400,
            )

        # Avoid overwriting an existing upload.
        stem = Path(filename).stem
        destination = UPLOADS / filename
        counter = 1

        while destination.exists():
            destination = UPLOADS / f"{stem}_{counter}{suffix}"
            counter += 1

        destination.write_bytes(data)

        json_response(self, {
            "success": True,
            "filename": destination.name,
            "size": len(data),
        })

    def handle_run(self):
        try:
            length = int(self.headers.get("Content-Length", 0))

            if length > 100_000:
                raise ValueError("Request body too large.")

            data = json.loads(self.rfile.read(length) or b"{}")

            video_name = data.get("video")

            if not video_name:
                raise ValueError("Select a video first.")

            # Prevent directory traversal.
            if Path(video_name).name != video_name:
                raise ValueError("Invalid video filename.")

            video_path = UPLOADS / video_name

            if not video_path.is_file():
                raise FileNotFoundError("Selected video does not exist.")

            settings = validate_settings(data.get("settings", {}))

            with JOB_LOCK:
                if JOB["running"]:
                    return json_response(
                        self,
                        {"error": "A pipeline is already running."},
                        409,
                    )

                JOB["running"] = True

            thread = threading.Thread(
                target=pipeline_worker,
                args=(video_name, settings),
                daemon=True,
            )
            thread.start()

            json_response(self, {
                "success": True,
                "message": "Pipeline started.",
            }, 202)

        except (ValueError, FileNotFoundError, json.JSONDecodeError) as exc:
            json_response(
                self,
                {"error": str(exc)},
                400,
            )

    def send_head(self):
        self.range_left = None

        header = self.headers.get("Range", "")
        path = self.translate_path(self.path)

        match = re.match(r"bytes=(\d*)-(\d*)$", header)

        if (
            not match
            or not (match.group(1) or match.group(2))
            or not os.path.isfile(path)
        ):
            return super().send_head()

        size = os.path.getsize(path)

        if match.group(1):
            start = int(match.group(1))
            end = int(match.group(2)) if match.group(2) else size - 1
        else:
            start = max(0, size - int(match.group(2)))
            end = size - 1

        end = min(end, size - 1)

        if start >= size or start > end:
            self.send_error(416, "Requested Range Not Satisfiable")
            return None

        file = open(path, "rb")
        file.seek(start)

        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header(
            "Content-Range",
            f"bytes {start}-{end}/{size}",
        )
        self.send_header(
            "Content-Length",
            str(end - start + 1),
        )
        self.end_headers()

        self.range_left = end - start + 1
        return file

    def copyfile(self, source, outputfile):
        if self.range_left is None:
            return super().copyfile(source, outputfile)

        remaining = self.range_left

        while remaining > 0:
            chunk = source.read(min(65536, remaining))

            if not chunk:
                break

            outputfile.write(chunk)
            remaining -= len(chunk)

    def handle(self):
        try:
            super().handle()
        except (
            ConnectionResetError,
            BrokenPipeError,
            ConnectionAbortedError,
        ):
            pass

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

    server = ThreadingHTTPServer(
        ("127.0.0.1", port),
        Handler,
    )

    print(f"Project: {ROOT}")
    print(f"Server:  http://localhost:{port}")
    print("Press Ctrl+C to stop.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        server.server_close()