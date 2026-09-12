#!/usr/bin/env python3
"""Finalise un enregistrement d'écran capturé par le navigateur.

Le navigateur produit un flux WebM (ou MP4) sans durée fiable dans l'en-tête :
MediaRecorder écrit un fichier « live » que les lecteurs n'arrivent pas à
naviguer. On le repasse par ffmpeg pour obtenir un fichier propre.
"""

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable

FORMATS = {
    "mp4": {
        "suffix": ".mp4",
        "args": [
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart",
        ],
    },
    "webm": {
        "suffix": ".webm",
        "args": ["-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-c:a", "libopus"],
    },
}

AUDIO_FORMATS = {
    "mp3": {"suffix": ".mp3", "args": ["-c:a", "libmp3lame", "-b:a", "192k"]},
    "wav": {"suffix": ".wav", "args": ["-c:a", "pcm_s16le"]},
    "m4a": {"suffix": ".m4a", "args": ["-c:a", "aac", "-b:a", "192k"]},
}

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


def _run_with_progress(
    cmd: list[str],
    input_path: Path,
    on_progress: ProgressCallback | None,
    known_duration: float | None,
) -> None:
    """Le conteneur webm brut de MediaRecorder n'a pas de durée fiable dans son en-tête
    (ffprobe y échoue souvent) : `known_duration` (mesurée côté navigateur pendant
    l'enregistrement) permet quand même un suivi de progression précis."""
    duration = known_duration or (probe_duration(input_path) if on_progress else None)

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


def finalize_recording(
    input_path: Path,
    output_path: Path,
    fmt: str = "mp4",
    on_progress: ProgressCallback | None = None,
    known_duration: float | None = None,
) -> None:
    """Réencode l'enregistrement vidéo brut vers un fichier lisible et navigable."""
    if fmt not in FORMATS:
        raise ValueError(f"Format non supporté : {fmt}")

    cmd = ["ffmpeg", "-y", "-i", str(input_path), *FORMATS[fmt]["args"], str(output_path)]
    _run_with_progress(cmd, input_path, on_progress, known_duration)


def finalize_audio_recording(
    input_path: Path,
    output_path: Path,
    fmt: str = "mp3",
    on_progress: ProgressCallback | None = None,
    known_duration: float | None = None,
) -> None:
    """Réencode un enregistrement audio seul (micro) capturé par le navigateur."""
    if fmt not in AUDIO_FORMATS:
        raise ValueError(f"Format non supporté : {fmt}")

    cmd = ["ffmpeg", "-y", "-i", str(input_path), "-vn", *AUDIO_FORMATS[fmt]["args"], str(output_path)]
    _run_with_progress(cmd, input_path, on_progress, known_duration)


def main() -> None:
    parser = argparse.ArgumentParser(description="Finaliser un enregistrement d'écran ou audio brut")
    parser.add_argument("recording", type=Path, help="Fichier brut issu du navigateur")
    parser.add_argument(
        "-f", "--format", choices=[*FORMATS, *AUDIO_FORMATS], default="mp4",
        help="Format de sortie (défaut: mp4)",
    )
    parser.add_argument("-o", "--output", type=Path, default=None, help="Chemin du fichier de sortie")
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        sys.exit("Erreur : ffmpeg introuvable dans le PATH.")

    if not args.recording.exists():
        sys.exit(f"Erreur : le fichier '{args.recording}' n'existe pas.")

    is_audio = args.format in AUDIO_FORMATS
    all_formats = AUDIO_FORMATS if is_audio else FORMATS
    output_path = args.output or args.recording.with_suffix(all_formats[args.format]["suffix"])

    def print_progress(frac: float) -> None:
        bar_width = 30
        filled = int(bar_width * frac)
        bar = "#" * filled + "-" * (bar_width - filled)
        print(f"\r[{bar}] {frac * 100:5.1f}%", end="", flush=True)

    try:
        if is_audio:
            finalize_audio_recording(args.recording, output_path, args.format, print_progress)
        else:
            finalize_recording(args.recording, output_path, args.format, print_progress)
    except RuntimeError as e:
        print()
        sys.exit(f"Erreur ffmpeg : {e}")

    print(f"\nEnregistrement finalisé : {output_path}")


if __name__ == "__main__":
    main()
