#!/usr/bin/env python3
"""Extrait la piste audio d'une vidéo via ffmpeg."""

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable

FORMATS = {
    "mp3": {"codec": "libmp3lame", "bitrates": ["128k", "192k", "256k", "320k"]},
    "wav": {"codec": "pcm_s16le", "bitrates": []},
    "aac": {"codec": "aac", "bitrates": ["128k", "192k", "256k"]},
    "flac": {"codec": "flac", "bitrates": []},
}

CHANNELS = {"mono": 1, "stereo": 2}

TIME_RE = re.compile(r"^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$")

ProgressCallback = Callable[[float], None]


def probe_duration(path: Path) -> float | None:
    cmd = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return float(result.stdout.strip())
    except ValueError:
        return None


def _parse_out_time(value: str) -> float | None:
    match = TIME_RE.match(value)
    if not match:
        return None
    h, m, s = match.groups()
    return int(h) * 3600 + int(m) * 60 + float(s)


def extract_audio(
    video_path: Path,
    output_path: Path,
    fmt: str = "mp3",
    bitrate: str | None = None,
    channels: str | None = None,
    sample_rate: int | None = None,
    on_progress: ProgressCallback | None = None,
) -> None:
    info = FORMATS[fmt]
    cmd = ["ffmpeg", "-y", "-i", str(video_path), "-vn", "-acodec", info["codec"]]

    if bitrate and info["bitrates"]:
        cmd += ["-b:a", bitrate]
    if channels:
        cmd += ["-ac", str(CHANNELS[channels])]
    if sample_rate:
        cmd += ["-ar", str(sample_rate)]

    cmd.append(str(output_path))

    duration = probe_duration(video_path) if on_progress else None

    full_cmd = cmd + ["-progress", "pipe:1", "-nostats"]
    proc = subprocess.Popen(full_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.strip()
        if not line.startswith("out_time="):
            continue
        elapsed = _parse_out_time(line.split("=", 1)[1])
        if elapsed is not None and duration and on_progress:
            on_progress(max(0.0, min(elapsed / duration, 1.0)))

    stderr = proc.stderr.read() if proc.stderr else ""
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(stderr.strip())

    if on_progress:
        on_progress(1.0)


def main() -> None:
    parser = argparse.ArgumentParser(description="Extraire l'audio d'une vidéo")
    parser.add_argument("video", type=Path, help="Chemin du fichier vidéo source")
    parser.add_argument(
        "-f", "--format", choices=FORMATS, default="mp3", help="Format audio de sortie (défaut: mp3)"
    )
    parser.add_argument("-b", "--bitrate", default=None, help="Bitrate audio (ex: 320k)")
    parser.add_argument("-c", "--channels", choices=CHANNELS, default=None, help="mono ou stereo")
    parser.add_argument("-r", "--sample-rate", type=int, default=None, help="Fréquence d'échantillonnage (ex: 44100)")
    parser.add_argument(
        "-o", "--output", type=Path, default=None, help="Chemin du fichier audio de sortie"
    )
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        sys.exit("Erreur : ffmpeg introuvable dans le PATH.")

    if not args.video.exists():
        sys.exit(f"Erreur : le fichier '{args.video}' n'existe pas.")

    output_path = args.output or args.video.with_suffix(f".{args.format}")

    def print_progress(frac: float) -> None:
        bar_width = 30
        filled = int(bar_width * frac)
        bar = "#" * filled + "-" * (bar_width - filled)
        print(f"\r[{bar}] {frac * 100:5.1f}%", end="", flush=True)

    try:
        extract_audio(
            args.video, output_path, args.format, args.bitrate, args.channels, args.sample_rate, print_progress
        )
    except RuntimeError as e:
        print()
        sys.exit(f"Erreur ffmpeg : {e}")

    print(f"\nAudio extrait : {output_path}")


if __name__ == "__main__":
    main()
