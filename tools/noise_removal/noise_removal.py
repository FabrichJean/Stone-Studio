#!/usr/bin/env python3
"""Réduit le bruit de fond d'un média (voix, bourdonnement) via le filtre ffmpeg afftdn."""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi", ".webm"}
AUDIO_CODECS = {".mp3": "libmp3lame", ".wav": "pcm_s16le", ".flac": "flac", ".aac": "aac", ".m4a": "aac"}

# afftdn accepte nr de 0.01 à 97 (dB de réduction visée) ; ces paliers couvrent
# le bruit de fond léger (souffle de micro) au bruit envahissant (climatisation, foule).
LEVELS = {"light": 8, "medium": 18, "strong": 32}


def remove_noise(
    input_path: Path,
    output_path: Path,
    level: str = "medium",
    reduce_hum: bool = False,
) -> None:
    if level not in LEVELS:
        raise ValueError(f"Niveau non supporté : {level}")

    ext = input_path.suffix.lower()
    has_video = ext in VIDEO_EXTS

    filters = []
    if reduce_hum:
        # Coupe le ronflement secteur (50/60 Hz) et les basses fréquences parasites
        # avant le débruitage, sinon afftdn les traite comme du signal utile.
        filters.append("highpass=f=100")
    filters.append(f"afftdn=nr={LEVELS[level]}:nf=-50")

    cmd = ["ffmpeg", "-y", "-i", str(input_path), "-af", ",".join(filters)]

    if has_video:
        cmd += ["-c:v", "copy", "-c:a", "aac"]
    else:
        cmd += ["-c:a", AUDIO_CODECS.get(ext, "aac")]

    cmd.append(str(output_path))

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())


def main() -> None:
    parser = argparse.ArgumentParser(description="Réduire le bruit de fond d'un média")
    parser.add_argument("media", type=Path, help="Chemin du fichier source")
    parser.add_argument(
        "-l", "--level", choices=LEVELS, default="medium", help="Intensité de la réduction (défaut: medium)"
    )
    parser.add_argument(
        "--reduce-hum", action="store_true", help="Coupe aussi le ronflement secteur / basses fréquences"
    )
    parser.add_argument("-o", "--output", type=Path, default=None, help="Chemin du fichier de sortie")
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        sys.exit("Erreur : ffmpeg introuvable dans le PATH.")
    if not args.media.exists():
        sys.exit(f"Erreur : le fichier '{args.media}' n'existe pas.")

    output_path = args.output or args.media.with_stem(args.media.stem + "_denoised")

    try:
        remove_noise(args.media, output_path, args.level, args.reduce_hum)
    except RuntimeError as e:
        sys.exit(f"Erreur ffmpeg : {e}")

    print(f"Bruit réduit : {output_path}")


if __name__ == "__main__":
    main()
