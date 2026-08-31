#!/usr/bin/env python3
"""Compresse une vidéo (taille de fichier réduite) via l'encodeur H.264 de ffmpeg."""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

# CRF plus élevé = plus de compression / moins de qualité. Le preset "slower" gagne
# quelques % de compression supplémentaires pour un même CRF, au prix du temps d'encodage.
LEVELS = {
    "light": {"crf": 20, "preset": "medium"},
    "medium": {"crf": 24, "preset": "medium"},
    "strong": {"crf": 30, "preset": "slower"},
}

# Hauteur cible en pixels ; la largeur est déduite (-2 = pair, requis par libx264).
RESOLUTIONS = {"original": None, "1080p": 1080, "720p": 720, "480p": 480}


def compress_video(
    input_path: Path,
    output_path: Path,
    level: str = "medium",
    resolution: str = "original",
) -> None:
    if level not in LEVELS:
        raise ValueError(f"Niveau non supporté : {level}")
    if resolution not in RESOLUTIONS:
        raise ValueError(f"Résolution non supportée : {resolution}")

    params = LEVELS[level]
    cmd = ["ffmpeg", "-y", "-i", str(input_path)]

    target_height = RESOLUTIONS[resolution]
    if target_height:
        # La virgule sépare normalement les filtres dans un -vf : on l'échappe pour qu'elle
        # reste un argument de la fonction min() au lieu d'être coupée par le parseur ffmpeg.
        cmd += ["-vf", f"scale=-2:min({target_height}\\,ih)"]

    cmd += [
        "-c:v", "libx264", "-preset", params["preset"], "-crf", str(params["crf"]),
        "-c:a", "aac", "-b:a", "128k",
        str(output_path),
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())


def main() -> None:
    parser = argparse.ArgumentParser(description="Compresser une vidéo")
    parser.add_argument("media", type=Path, help="Chemin du fichier source")
    parser.add_argument(
        "-l", "--level", choices=LEVELS, default="medium", help="Intensité de la compression (défaut: medium)"
    )
    parser.add_argument(
        "-r", "--resolution", choices=RESOLUTIONS, default="original", help="Résolution cible (défaut: original)"
    )
    parser.add_argument("-o", "--output", type=Path, default=None, help="Chemin du fichier de sortie")
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        sys.exit("Erreur : ffmpeg introuvable dans le PATH.")
    if not args.media.exists():
        sys.exit(f"Erreur : le fichier '{args.media}' n'existe pas.")

    output_path = args.output or args.media.with_stem(args.media.stem + "_compressed")

    try:
        compress_video(args.media, output_path, args.level, args.resolution)
    except RuntimeError as e:
        sys.exit(f"Erreur ffmpeg : {e}")

    print(f"Vidéo compressée : {output_path}")


if __name__ == "__main__":
    main()
