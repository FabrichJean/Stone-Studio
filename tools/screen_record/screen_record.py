#!/usr/bin/env python3
"""Finalise un enregistrement d'écran capturé par le navigateur.

Le navigateur produit un flux WebM (ou MP4) sans durée fiable dans l'en-tête :
MediaRecorder écrit un fichier « live » que les lecteurs n'arrivent pas à
naviguer. On le repasse par ffmpeg pour obtenir un fichier propre.
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

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


def finalize_recording(input_path: Path, output_path: Path, fmt: str = "mp4") -> None:
    """Réencode l'enregistrement brut vers un fichier lisible et navigable."""
    if fmt not in FORMATS:
        raise ValueError(f"Format non supporté : {fmt}")

    cmd = ["ffmpeg", "-y", "-i", str(input_path), *FORMATS[fmt]["args"], str(output_path)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())


def main() -> None:
    parser = argparse.ArgumentParser(description="Finaliser un enregistrement d'écran brut")
    parser.add_argument("recording", type=Path, help="Fichier brut issu du navigateur")
    parser.add_argument(
        "-f", "--format", choices=FORMATS, default="mp4", help="Format de sortie (défaut: mp4)"
    )
    parser.add_argument("-o", "--output", type=Path, default=None, help="Chemin du fichier de sortie")
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        sys.exit("Erreur : ffmpeg introuvable dans le PATH.")

    if not args.recording.exists():
        sys.exit(f"Erreur : le fichier '{args.recording}' n'existe pas.")

    output_path = args.output or args.recording.with_suffix(FORMATS[args.format]["suffix"])

    try:
        finalize_recording(args.recording, output_path, args.format)
    except RuntimeError as e:
        sys.exit(f"Erreur ffmpeg : {e}")

    print(f"Enregistrement finalisé : {output_path}")


if __name__ == "__main__":
    main()
