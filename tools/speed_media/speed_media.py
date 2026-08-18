#!/usr/bin/env python3
"""Modifie la vitesse d'un média (globalement ou par morceaux) via ffmpeg."""

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

TIME_RE = re.compile(r"^(\d{1,2}:)?(\d{1,2}:)?\d{1,2}(\.\d+)?$")
VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi", ".webm"}
AUDIO_CODECS = {".mp3": "libmp3lame", ".wav": "pcm_s16le", ".flac": "flac", ".aac": "aac", ".m4a": "aac"}


def is_valid_time(value: str) -> bool:
    return bool(TIME_RE.match(value))


def time_to_seconds(value: str) -> float:
    parts = [float(p) for p in value.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0.0)
    h, m, s = parts
    return h * 3600 + m * 60 + s


def atempo_chain(factor: float) -> str:
    """Le filtre atempo de ffmpeg n'accepte que [0.5, 2.0] — on chaîne plusieurs instances au-delà."""
    if factor <= 0:
        raise ValueError("Le facteur de vitesse doit être positif.")

    filters = []
    remaining = factor
    while remaining > 2.0:
        filters.append("atempo=2.0")
        remaining /= 2.0
    while remaining < 0.5:
        filters.append("atempo=0.5")
        remaining /= 0.5
    filters.append(f"atempo={remaining:.6f}")
    return ",".join(filters)


def change_speed(
    input_path: Path,
    output_path: Path,
    factor: float,
    start: str | None = None,
    end: str | None = None,
) -> None:
    ext = input_path.suffix.lower()
    has_video = ext in VIDEO_EXTS

    audio_filter = atempo_chain(factor)
    video_filter = f"setpts=PTS/{factor}"

    # Le trim est fait dans le graphe de filtres plutôt que via -ss/-to : combiner -ss/-to
    # (seek "accurate" en option de sortie) avec un filtre de vitesse fait que ffmpeg ignore
    # silencieusement le filtre dans certaines versions.
    if start or end:
        bounds = []
        if start:
            bounds.append(f"start={time_to_seconds(start)}")
        if end:
            bounds.append(f"end={time_to_seconds(end)}")
        trim_expr = ":".join(bounds)
        audio_filter = f"atrim={trim_expr},asetpts=PTS-STARTPTS,{audio_filter}"
        video_filter = f"trim={trim_expr},setpts=PTS-STARTPTS,{video_filter}"

    cmd = ["ffmpeg", "-y", "-i", str(input_path), "-filter:a", audio_filter]

    if has_video:
        cmd += ["-filter:v", video_filter, "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-c:a", "aac"]
    else:
        cmd += ["-c:a", AUDIO_CODECS.get(ext, "aac")]

    cmd.append(str(output_path))

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())


def speed_segments(input_path: Path, segments: list[dict], output_path: Path) -> None:
    """segments: [{"start": str, "end": str, "factor": float}, ...] — vitesse propre à chaque morceau."""
    if not segments:
        raise ValueError("Aucun segment fourni.")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        part_paths = []

        for i, seg in enumerate(segments):
            part_path = tmp_dir / f"part_{i}{input_path.suffix}"
            change_speed(input_path, part_path, seg["factor"], seg["start"], seg["end"])
            part_paths.append(part_path)

        concat_list = tmp_dir / "concat.txt"
        concat_list.write_text("\n".join(f"file '{p.as_posix()}'" for p in part_paths))

        cmd = [
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", str(concat_list), "-c", "copy", str(output_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip())


def main() -> None:
    parser = argparse.ArgumentParser(description="Modifier la vitesse d'un média")
    parser.add_argument("media", type=Path, help="Chemin du fichier source")
    parser.add_argument("-f", "--factor", type=float, default=1.0, help="Facteur de vitesse global (ex: 1.5, 0.5)")
    parser.add_argument(
        "--segment", nargs=3, metavar=("START", "END", "FACTOR"), action="append", default=None,
        help="Segment avec sa propre vitesse (répétable) : START END FACTOR",
    )
    parser.add_argument("-o", "--output", type=Path, default=None, help="Chemin du fichier de sortie")
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        sys.exit("Erreur : ffmpeg introuvable dans le PATH.")
    if not args.media.exists():
        sys.exit(f"Erreur : le fichier '{args.media}' n'existe pas.")

    if args.segment:
        segments = []
        for start, end, factor in args.segment:
            if not is_valid_time(start) or not is_valid_time(end):
                sys.exit(f"Erreur : format de temps invalide ('{start}', '{end}'). Utiliser HH:MM:SS.")
            segments.append({"start": start, "end": end, "factor": float(factor)})

        output_path = args.output or args.media.with_stem(args.media.stem + "_speed")
        try:
            speed_segments(args.media, segments, output_path)
        except RuntimeError as e:
            sys.exit(f"Erreur ffmpeg : {e}")
        print(f"Vitesse appliquée par morceaux : {output_path}")
        return

    output_path = args.output or args.media.with_stem(args.media.stem + "_speed")
    try:
        change_speed(args.media, output_path, args.factor)
    except RuntimeError as e:
        sys.exit(f"Erreur ffmpeg : {e}")

    print(f"Vitesse modifiée ({args.factor}x) : {output_path}")


if __name__ == "__main__":
    main()
