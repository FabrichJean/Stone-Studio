#!/usr/bin/env python3
"""Extrait la piste audio d'une vidéo via ffmpeg."""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

FORMATS = {
    "mp3": {"codec": "libmp3lame", "bitrates": ["128k", "192k", "256k", "320k"]},
    "wav": {"codec": "pcm_s16le", "bitrates": []},
    "aac": {"codec": "aac", "bitrates": ["128k", "192k", "256k"]},
    "flac": {"codec": "flac", "bitrates": []},
}

CHANNELS = {"mono": 1, "stereo": 2}


def extract_audio(
    video_path: Path,
    output_path: Path,
    fmt: str = "mp3",
    bitrate: str | None = None,
    channels: str | None = None,
    sample_rate: int | None = None,
) -> None:
    info = FORMATS[fmt]
    cmd = ["ffmpeg", "-y", "-i", str(video_path), "-vn", "-acodec", info["codec"]]

    if bitrate and info["bitrates"]:
        cmd += ["-b:a", bitrate]
    if channels:
        cmd += ["-ac", str(CHANNELS[channels])]
    if sample_rate:
        cmd += ["-ar", str(sample_rate)]

    cmd.append(str(output_path))

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())


def main() -> None:
    parser = argparse.ArgumentParser(description="Extraire l'audio d'une vidéo")
    parser.add_argument("video", type=Path, help="Chemin du fichier vidéo source")
    parser.add_argument(
        "-f", "--format", choices=FORMATS, default="mp3", help="Format audio de sortie (défaut: mp3)"
    )
    parser.add_argument("-b", "--bitrate", default=None, help="Bitrate audio (ex: 320k)")
    parser.add_argument("-c", "--channels", choices=CHANNELS, default=None, help="mono ou stereo")
    parser.add_argument("-r", "--sample-rate", type=int, default=None, help="Fréquence d'échantillonnage (ex: 44100)")
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
        extract_audio(args.video, output_path, args.format, args.bitrate, args.channels, args.sample_rate)
    except RuntimeError as e:
        sys.exit(f"Erreur ffmpeg : {e}")

    print(f"Audio extrait : {output_path}")


if __name__ == "__main__":
    main()
