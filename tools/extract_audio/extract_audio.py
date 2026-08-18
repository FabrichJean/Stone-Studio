#!/usr/bin/env python3
"""Extrait la piste audio d'une vidéo via ffmpeg."""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

FORMATS = {
    "mp3": ["-vn", "-acodec", "libmp3lame", "-q:a", "2"],
    "wav": ["-vn", "-acodec", "pcm_s16le"],
    "aac": ["-vn", "-acodec", "aac", "-b:a", "192k"],
    "flac": ["-vn", "-acodec", "flac"],
}


def extract_audio(video_path: Path, output_path: Path, fmt: str) -> None:
    codec_args = FORMATS[fmt]
    cmd = ["ffmpeg", "-y", "-i", str(video_path), *codec_args, str(output_path)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())


def main() -> None:
    parser = argparse.ArgumentParser(description="Extraire l'audio d'une vidéo")
    parser.add_argument("video", type=Path, help="Chemin du fichier vidéo source")
    parser.add_argument(
        "-f", "--format", choices=FORMATS, default="mp3", help="Format audio de sortie (défaut: mp3)"
    )
    parser.add_argument(
        "-o", "--output", type=Path, default=None, help="Chemin du fichier audio de sortie"
    )
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        sys.exit("Erreur : ffmpeg introuvable dans le PATH.")

    if not args.video.exists():
        sys.exit(f"Erreur : le fichier '{args.video}' n'existe pas.")

    output_path = args.output or args.video.with_suffix(f".{args.format}")

    try:
        extract_audio(args.video, output_path, args.format)
    except RuntimeError as e:
        sys.exit(f"Erreur ffmpeg : {e}")

    print(f"Audio extrait : {output_path}")


if __name__ == "__main__":
    main()
