"""Sondage média et génération de miniatures pour le catalogue de projets."""

import json
import subprocess
from pathlib import Path

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi", ".webm"}


def probe_media(path: Path) -> dict:
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-show_entries", "format=duration",
        "-of", "json", str(path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return {"media_type": "other", "duration": None, "width": None, "height": None}

    data = json.loads(result.stdout)
    duration = data.get("format", {}).get("duration")
    duration = float(duration) if duration else None

    streams = data.get("streams", [])
    if streams:
        width = streams[0].get("width")
        height = streams[0].get("height")
        media_type = "video"
    else:
        width = height = None
        media_type = "audio" if path.suffix.lower() not in VIDEO_EXTS else "video"

    return {"media_type": media_type, "duration": duration, "width": width, "height": height}


def generate_thumbnail(input_path: Path, output_path: Path, duration: float | None) -> bool:
    at = min(1.0, duration / 3) if duration else 0.5
    cmd = [
        "ffmpeg", "-y", "-ss", str(at), "-i", str(input_path),
        "-frames:v", "1", "-vf", "scale=320:-1",
        str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.returncode == 0 and output_path.exists()
