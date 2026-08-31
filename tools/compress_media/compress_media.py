#!/usr/bin/env python3
"""Compresse une vidéo (taille de fichier réduite) via l'encodeur H.264 de ffmpeg."""

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable

# CRF plus élevé = plus de compression / moins de qualité. Le preset "slower" gagne
# quelques % de compression supplémentaires pour un même CRF, au prix du temps d'encodage.
LEVELS = {
    "light": {"crf": 20, "preset": "medium"},
    "medium": {"crf": 24, "preset": "medium"},
    "strong": {"crf": 30, "preset": "slower"},
}

# Hauteur cible en pixels ; la largeur est déduite (-2 = pair, requis par libx264).
RESOLUTIONS = {"original": None, "1080p": 1080, "720p": 720, "480p": 480}

AUDIO_BITRATE_KBPS = 128
# Plancher de bitrate vidéo : en dessous, l'image se dégrade au point d'être inutilisable,
# mieux vaut dépasser légèrement la taille demandée que produire un résultat illisible.
MIN_VIDEO_KBPS = 100

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


def compute_target_video_kbps(duration: float, target_size_mb: float, audio_kbps: int = AUDIO_BITRATE_KBPS) -> int:
    if duration <= 0:
        raise ValueError("Durée du média inconnue ou nulle : impossible de viser une taille précise.")
    target_kbits = target_size_mb * 1024 * 8
    total_kbps = target_kbits / duration
    return max(int(total_kbps - audio_kbps), MIN_VIDEO_KBPS)


def _parse_out_time(value: str) -> float | None:
    match = TIME_RE.match(value)
    if not match:
        return None
    h, m, s = match.groups()
    return int(h) * 3600 + int(m) * 60 + float(s)


def _run_ffmpeg_progress(
    cmd: list[str],
    duration: float | None,
    on_progress: ProgressCallback | None,
    start: float,
    end: float,
) -> None:
    """Exécute ffmpeg en suivant sa progression via -progress pipe:1, et rapporte une
    fraction globale [start, end] (permet de composer plusieurs passes en un seul suivi)."""
    full_cmd = cmd + ["-progress", "pipe:1", "-nostats"]
    proc = subprocess.Popen(full_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.strip()
        if not line.startswith("out_time="):
            continue
        elapsed = _parse_out_time(line.split("=", 1)[1])
        if elapsed is not None and duration and on_progress:
            frac = max(0.0, min(elapsed / duration, 1.0))
            on_progress(start + frac * (end - start))

    stderr = proc.stderr.read() if proc.stderr else ""
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(stderr.strip())

    if on_progress:
        on_progress(end)


def compress_video(
    input_path: Path,
    output_path: Path,
    level: str = "medium",
    resolution: str = "original",
    max_size_mb: float | None = None,
    on_progress: ProgressCallback | None = None,
) -> None:
    if level not in LEVELS:
        raise ValueError(f"Niveau non supporté : {level}")
    if resolution not in RESOLUTIONS:
        raise ValueError(f"Résolution non supportée : {resolution}")
    if max_size_mb is not None and max_size_mb <= 0:
        raise ValueError("La taille maximale doit être positive.")

    params = LEVELS[level]
    scale_filter = []
    target_height = RESOLUTIONS[resolution]
    if target_height:
        # La virgule sépare normalement les filtres dans un -vf : on l'échappe pour qu'elle
        # reste un argument de la fonction min() au lieu d'être coupée par le parseur ffmpeg.
        scale_filter = ["-vf", f"scale=-2:min({target_height}\\,ih)"]

    if max_size_mb is None:
        cmd = [
            "ffmpeg", "-y", "-i", str(input_path), *scale_filter,
            "-c:v", "libx264", "-preset", params["preset"], "-crf", str(params["crf"]),
            "-c:a", "aac", "-b:a", f"{AUDIO_BITRATE_KBPS}k",
            str(output_path),
        ]
        duration = probe_duration(input_path) if on_progress else None
        _run_ffmpeg_progress(cmd, duration, on_progress, 0.0, 1.0)
        return

    duration = probe_duration(input_path)
    if not duration:
        raise RuntimeError("Impossible de déterminer la durée du média pour viser une taille précise.")
    video_kbps = compute_target_video_kbps(duration, max_size_mb)

    # Encodage 2 passes : la taille finale ne peut être respectée fidèlement qu'en laissant
    # ffmpeg répartir le débit selon la complexité réelle du contenu (analysée en passe 1).
    with tempfile.TemporaryDirectory() as tmp:
        passlog = str(Path(tmp) / "ffmpeg2pass")
        null_output = "/dev/null" if sys.platform != "win32" else "NUL"

        pass1_cmd = [
            "ffmpeg", "-y", "-i", str(input_path), *scale_filter,
            "-c:v", "libx264", "-preset", params["preset"], "-b:v", f"{video_kbps}k",
            "-pass", "1", "-passlogfile", passlog, "-an", "-f", "mp4", null_output,
        ]
        _run_ffmpeg_progress(pass1_cmd, duration, on_progress, 0.0, 0.5)

        pass2_cmd = [
            "ffmpeg", "-y", "-i", str(input_path), *scale_filter,
            "-c:v", "libx264", "-preset", params["preset"], "-b:v", f"{video_kbps}k",
            "-pass", "2", "-passlogfile", passlog,
            "-c:a", "aac", "-b:a", f"{AUDIO_BITRATE_KBPS}k",
            str(output_path),
        ]
        _run_ffmpeg_progress(pass2_cmd, duration, on_progress, 0.5, 1.0)


def main() -> None:
    parser = argparse.ArgumentParser(description="Compresser une vidéo")
    parser.add_argument("media", type=Path, help="Chemin du fichier source")
    parser.add_argument(
        "-l", "--level", choices=LEVELS, default="medium", help="Intensité de la compression (défaut: medium)"
    )
    parser.add_argument(
        "-r", "--resolution", choices=RESOLUTIONS, default="original", help="Résolution cible (défaut: original)"
    )
    parser.add_argument(
        "-s", "--max-size", type=float, default=None, metavar="MO", help="Taille maximale visée, en méga-octets"
    )
    parser.add_argument("-o", "--output", type=Path, default=None, help="Chemin du fichier de sortie")
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        sys.exit("Erreur : ffmpeg introuvable dans le PATH.")
    if not args.media.exists():
        sys.exit(f"Erreur : le fichier '{args.media}' n'existe pas.")

    output_path = args.output or args.media.with_stem(args.media.stem + "_compressed")

    def print_progress(frac: float) -> None:
        bar_width = 30
        filled = int(bar_width * frac)
        bar = "#" * filled + "-" * (bar_width - filled)
        print(f"\r[{bar}] {frac * 100:5.1f}%", end="", flush=True)

    try:
        compress_video(args.media, output_path, args.level, args.resolution, args.max_size, print_progress)
    except (RuntimeError, ValueError) as e:
        print()
        sys.exit(f"Erreur : {e}")

    print(f"\nVidéo compressée : {output_path}")


if __name__ == "__main__":
    main()
