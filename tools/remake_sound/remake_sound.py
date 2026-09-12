#!/usr/bin/env python3
"""Retouche le son d'un média en appliquant un preset d'effets ffmpeg (cinématique,
autotune stylisé, basse propre, ...)."""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi", ".webm"}
AUDIO_CODECS = {".mp3": "libmp3lame", ".wav": "pcm_s16le", ".flac": "flac", ".aac": "aac", ".m4a": "aac"}

# Chaque preset est une liste de filtres ffmpeg (-af) appliqués dans l'ordre.
# NB : "autotune" est une approximation stylisée (chorus + vibrato) — ffmpeg n'a pas de
# correction de justesse note à note comme un vrai plugin Auto-Tune, qui nécessite une
# détection de pitch dédiée (ex: rubberband/aubio) hors de portée d'une simple chaîne -af.
PRESETS = {
    "cinematic": {
        "label": "Son cinématique",
        "description": "Profondeur et largeur stéréo façon bande-son de film.",
        "filters": [
            "equalizer=f=80:t=q:w=1:g=4",
            "equalizer=f=8000:t=q:w=1:g=3",
            "aecho=0.8:0.7:40:0.25",
            "extrastereo=m=2.2",
            "acompressor=threshold=-18dB:ratio=3:attack=15:release=250",
        ],
    },
    "autotune": {
        "label": "Autotune (effet vocal stylisé)",
        "description": "Effet vocal robotique/harmonisé par chorus et vibrato.",
        "filters": [
            "highpass=f=100",
            "chorus=0.5:0.9:55:0.4:0.25:2",
            "vibrato=f=6:d=0.3",
            "equalizer=f=3000:t=q:w=1:g=3",
        ],
    },
    "clean_bass": {
        "label": "Basse très propre",
        "description": "Renforce et clarifie les basses tout en coupant le rumble.",
        "filters": [
            "highpass=f=30",
            "bass=g=7:f=90",
            "equalizer=f=250:t=q:w=1.5:g=-2",
            "acompressor=threshold=-20dB:ratio=4:attack=5:release=100",
        ],
    },
    "warm_voice": {
        "label": "Voix chaude (podcast/radio)",
        "description": "Chaleur et présence, idéal pour de la voix parlée.",
        "filters": [
            "equalizer=f=200:t=q:w=1:g=3",
            "equalizer=f=6000:t=q:w=1:g=2",
            "acompressor=threshold=-18dB:ratio=3:attack=10:release=200",
        ],
    },
    "bright_clarity": {
        "label": "Clarté / brillance",
        "description": "Éclaircit le son en boostant les aigus pour plus de netteté.",
        "filters": [
            "highpass=f=60",
            "equalizer=f=4000:t=q:w=1:g=2",
            "equalizer=f=10000:t=q:w=1:g=5",
        ],
    },
}


def remake_sound(input_path: Path, output_path: Path, preset: str) -> None:
    if preset not in PRESETS:
        raise ValueError(f"Preset non supporté : {preset}")

    ext = input_path.suffix.lower()
    has_video = ext in VIDEO_EXTS

    # Les presets combinent EQ, écho et élargissement stéréo, qui peuvent pousser le signal
    # hors de l'intervalle [-1, 1] (surtout sur un audio déjà débruité, avec de longs passages
    # quasi silencieux). Sans limiteur, ces valeurs extrêmes font planter libmp3lame
    # (assertion "el >= 0" dans calc_energy) au lieu de simplement clipper le son.
    filters = ",".join([*PRESETS[preset]["filters"], "alimiter=limit=0.95"])
    cmd = ["ffmpeg", "-y", "-i", str(input_path), "-af", filters]

    if has_video:
        cmd += ["-c:v", "copy", "-c:a", "aac"]
    else:
        cmd += ["-c:a", AUDIO_CODECS.get(ext, "aac")]

    cmd.append(str(output_path))

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())


def main() -> None:
    parser = argparse.ArgumentParser(description="Retoucher le son d'un média avec un preset")
    parser.add_argument("media", type=Path, help="Chemin du fichier source")
    parser.add_argument(
        "-p", "--preset", choices=PRESETS, default="cinematic", help="Preset à appliquer (défaut: cinematic)"
    )
    parser.add_argument("-o", "--output", type=Path, default=None, help="Chemin du fichier de sortie")
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        sys.exit("Erreur : ffmpeg introuvable dans le PATH.")
    if not args.media.exists():
        sys.exit(f"Erreur : le fichier '{args.media}' n'existe pas.")

    output_path = args.output or args.media.with_stem(args.media.stem + "_remake")

    try:
        remake_sound(args.media, output_path, args.preset)
    except RuntimeError as e:
        sys.exit(f"Erreur ffmpeg : {e}")

    print(f"Son retouché ({PRESETS[args.preset]['label']}) : {output_path}")


if __name__ == "__main__":
    main()
