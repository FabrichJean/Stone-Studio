#!/usr/bin/env python3
"""Ajuste le volume d'un média (globalement ou par morceaux) via le filtre ffmpeg volume."""

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable

TIME_RE = re.compile(r"^(\d{1,2}:)?(\d{1,2}:)?\d{1,2}(\.\d+)?$")
OUT_TIME_RE = re.compile(r"^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$")
VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi", ".webm"}
AUDIO_CODECS = {".mp3": "libmp3lame", ".wav": "pcm_s16le", ".flac": "flac", ".aac": "aac", ".m4a": "aac"}

ProgressCallback = Callable[[float], None]


def is_valid_time(value: str) -> bool:
    return bool(TIME_RE.match(value))


def time_to_seconds(value: str) -> float:
    parts = [float(p) for p in value.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0.0)
    h, m, s = parts
    return h * 3600 + m * 60 + s


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
    match = OUT_TIME_RE.match(value)
    if not match:
        return None
    h, m, s = match.groups()
    return int(h) * 3600 + int(m) * 60 + float(s)


def _run(input_path: Path, output_path: Path, audio_filter: str, on_progress: ProgressCallback | None = None) -> None:
    ext = input_path.suffix.lower()
    has_video = ext in VIDEO_EXTS

    cmd = ["ffmpeg", "-y", "-i", str(input_path), "-af", audio_filter]
    if has_video:
        cmd += ["-c:v", "copy", "-c:a", "aac"]
    else:
        cmd += ["-c:a", AUDIO_CODECS.get(ext, "aac")]
    cmd.append(str(output_path))

    if not on_progress:
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip())
        return

    duration = probe_duration(input_path)
    full_cmd = cmd + ["-progress", "pipe:1", "-nostats"]
    proc = subprocess.Popen(full_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.strip()
        if not line.startswith("out_time="):
            continue
        elapsed = _parse_out_time(line.split("=", 1)[1])
        if elapsed is not None and duration:
            on_progress(max(0.0, min(elapsed / duration, 1.0)))

    stderr = proc.stderr.read() if proc.stderr else ""
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(stderr.strip())
    on_progress(1.0)


def change_volume(
    input_path: Path, output_path: Path, factor: float, on_progress: ProgressCallback | None = None
) -> None:
    if factor < 0:
        raise ValueError("Le facteur de volume doit être positif.")
    # alimiter en filet de sécurité : une amplification peut faire dépasser [-1, 1], ce qui a
    # déjà fait planter libmp3lame (assertion calc_energy) sur un export mp3 amplifié.
    _run(input_path, output_path, f"volume={factor},alimiter=limit=0.95", on_progress)


def volume_segments(
    input_path: Path, segments: list[dict], output_path: Path, on_progress: ProgressCallback | None = None
) -> None:
    """segments: [{"start": str, "end": str, "factor": float}, ...] — volume propre à chaque
    morceau, le reste du fichier gardant son volume d'origine. Un seul passage ffmpeg : hors de
    sa fenêtre 'enable', un filtre volume se comporte comme un passe-plat, donc pas besoin de
    découper le fichier en segments puis les recombiner (ce qui imposerait de ré-encoder la
    vidéo et laisserait des coutures)."""
    if not segments:
        raise ValueError("Aucun segment fourni.")

    parts = []
    for seg in segments:
        start_s = time_to_seconds(seg["start"])
        end_s = time_to_seconds(seg["end"])
        parts.append(f"volume=enable='between(t,{start_s},{end_s})':volume={seg['factor']}")
    parts.append("alimiter=limit=0.95")

    _run(input_path, output_path, ",".join(parts), on_progress)


def main() -> None:
    parser = argparse.ArgumentParser(description="Ajuster le volume d'un média")
    parser.add_argument("media", type=Path, help="Chemin du fichier source")
    parser.add_argument("-f", "--factor", type=float, default=1.0, help="Facteur de volume global (ex: 1.5, 0.5)")
    parser.add_argument(
        "--segment", nargs=3, metavar=("START", "END", "FACTOR"), action="append", default=None,
        help="Segment avec son propre volume (répétable) : START END FACTOR",
    )
    parser.add_argument("-o", "--output", type=Path, default=None, help="Chemin du fichier de sortie")
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        sys.exit("Erreur : ffmpeg introuvable dans le PATH.")
    if not args.media.exists():
        sys.exit(f"Erreur : le fichier '{args.media}' n'existe pas.")

    def print_progress(frac: float) -> None:
        bar_width = 30
        filled = int(bar_width * frac)
        bar = "#" * filled + "-" * (bar_width - filled)
        print(f"\r[{bar}] {frac * 100:5.1f}%", end="", flush=True)

    output_path = args.output or args.media.with_stem(args.media.stem + "_volume")

    try:
        if args.segment:
            segments = []
            for start, end, factor in args.segment:
                if not is_valid_time(start) or not is_valid_time(end):
                    sys.exit(f"Erreur : format de temps invalide ('{start}', '{end}'). Utiliser HH:MM:SS.")
                segments.append({"start": start, "end": end, "factor": float(factor)})
            volume_segments(args.media, segments, output_path, print_progress)
        else:
            change_volume(args.media, output_path, args.factor, print_progress)
    except RuntimeError as e:
        print()
        sys.exit(f"Erreur ffmpeg : {e}")

    print(f"\nVolume ajusté : {output_path}")


if __name__ == "__main__":
    main()
