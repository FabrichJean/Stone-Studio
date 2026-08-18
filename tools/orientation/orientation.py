#!/usr/bin/env python3
"""Modifie l'orientation d'une vidéo (rotation, miroir) via ffmpeg."""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ACTIONS = {
    "rotate_90_cw": "transpose=1",
    "rotate_90_ccw": "transpose=2",
    "rotate_180": "transpose=1,transpose=1",
    "flip_horizontal": "hflip",
    "flip_vertical": "vflip",
}


def change_orientation(input_path: Path, output_path: Path, action: str) -> None:
    if action not in ACTIONS:
        raise ValueError(f"Action inconnue : {action}. Choix possibles : {', '.join(ACTIONS)}")

    cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-vf", ACTIONS[action],
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-c:a", "copy",
        str(output_path),
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())


def main() -> None:
    parser = argparse.ArgumentParser(description="Modifier l'orientation d'une vidéo")
    parser.add_argument("video", type=Path, help="Chemin du fichier vidéo source")
    parser.add_argument("-a", "--action", choices=ACTIONS, required=True, help="Action d'orientation à appliquer")
    parser.add_argument("-o", "--output", type=Path, default=None, help="Chemin du fichier de sortie")
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        sys.exit("Erreur : ffmpeg introuvable dans le PATH.")
    if not args.video.exists():
        sys.exit(f"Erreur : le fichier '{args.video}' n'existe pas.")

    output_path = args.output or args.video.with_stem(args.video.stem + "_orientation")

    try:
        change_orientation(args.video, output_path, args.action)
    except RuntimeError as e:
        sys.exit(f"Erreur ffmpeg : {e}")

    print(f"Orientation modifiée ({args.action}) : {output_path}")


if __name__ == "__main__":
    main()
