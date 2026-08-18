#!/usr/bin/env python3
"""Découpe un segment d'un fichier audio ou vidéo via ffmpeg."""

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

TIME_RE = re.compile(r"^(\d{1,2}:)?(\d{1,2}:)?\d{1,2}(\.\d+)?$")

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi", ".webm"}
AUDIO_CODECS = {".mp3": "libmp3lame", ".wav": "pcm_s16le", ".flac": "flac", ".aac": "aac", ".m4a": "aac"}


def is_valid_time(value: str) -> bool:
    return bool(TIME_RE.match(value))


def trim_media(input_path: Path, output_path: Path, start: str, end: str | None = None, duration: str | None = None) -> None:
    # -ss placé après -i pour un point de coupe précis à la frame (réencodage requis,
    # sinon la coupe s'arrondit à la keyframe la plus proche et l'image se fige au début).
    cmd = ["ffmpeg", "-y", "-i", str(input_path), "-ss", start]

    if end:
        cmd += ["-to", end]
    elif duration:
        cmd += ["-t", duration]

    ext = input_path.suffix.lower()
    if ext in VIDEO_EXTS:
        cmd += ["-c:v", "libx264", "-preset", "fast", "-crf", "18", "-c:a", "aac"]
    else:
        cmd += ["-c:a", AUDIO_CODECS.get(ext, "aac")]

    cmd.append(str(output_path))

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())


def main() -> None:
    parser = argparse.ArgumentParser(description="Découper un segment d'un fichier audio ou vidéo")
    parser.add_argument("media", type=Path, help="Chemin du fichier source")
    parser.add_argument("-s", "--start", default="00:00:00", help="Temps de début (HH:MM:SS, défaut: 00:00:00)")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("-e", "--end", default=None, help="Temps de fin (HH:MM:SS)")
    group.add_argument("-d", "--duration", default=None, help="Durée du segment (HH:MM:SS)")
    parser.add_argument("-o", "--output", type=Path, default=None, help="Chemin du fichier de sortie")
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        sys.exit("Erreur : ffmpeg introuvable dans le PATH.")

    if not args.media.exists():
        sys.exit(f"Erreur : le fichier '{args.media}' n'existe pas.")

    for label, value in (("--start", args.start), ("--end", args.end), ("--duration", args.duration)):
        if value and not is_valid_time(value):
            sys.exit(f"Erreur : format de temps invalide pour {label} ('{value}'). Utiliser HH:MM:SS.")

    output_path = args.output or args.media.with_stem(args.media.stem + "_trim")

    try:
        trim_media(args.media, output_path, args.start, args.end, args.duration)
    except RuntimeError as e:
        sys.exit(f"Erreur ffmpeg : {e}")

    print(f"Segment découpé : {output_path}")


if __name__ == "__main__":
    main()
