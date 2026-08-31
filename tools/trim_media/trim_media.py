#!/usr/bin/env python3
"""Découpe un segment d'un fichier audio ou vidéo via ffmpeg."""

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable

TIME_RE = re.compile(r"^(\d{1,2}:)?(\d{1,2}:)?\d{1,2}(\.\d+)?$")
OUT_TIME_RE = re.compile(r"^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$")

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi", ".webm"}
AUDIO_CODECS = {".mp3": "libmp3lame", ".wav": "pcm_s16le", ".flac": "flac", ".aac": "aac", ".m4a": "aac"}

ProgressCallback = Callable[[float], None]


def is_valid_time(value: str) -> bool:
    return bool(TIME_RE.match(value))


def _time_to_seconds(value: str) -> float:
    parts = [float(p) for p in value.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0.0)
    h, m, s = parts
    return h * 3600 + m * 60 + s


def _parse_out_time(value: str) -> float | None:
    match = OUT_TIME_RE.match(value)
    if not match:
        return None
    h, m, s = match.groups()
    return int(h) * 3600 + int(m) * 60 + float(s)


def _run_ffmpeg_progress(
    cmd: list[str], seg_duration: float | None, on_progress: ProgressCallback | None, start: float, end: float
) -> None:
    """Exécute ffmpeg en suivant sa progression via -progress pipe:1, et rapporte une
    fraction globale [start, end] (permet de composer plusieurs segments en un seul suivi)."""
    full_cmd = cmd + ["-progress", "pipe:1", "-nostats"]
    proc = subprocess.Popen(full_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.strip()
        if not line.startswith("out_time="):
            continue
        elapsed = _parse_out_time(line.split("=", 1)[1])
        if elapsed is not None and seg_duration and on_progress:
            frac = max(0.0, min(elapsed / seg_duration, 1.0))
            on_progress(start + frac * (end - start))

    stderr = proc.stderr.read() if proc.stderr else ""
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(stderr.strip())

    if on_progress:
        on_progress(end)


def trim_media(
    input_path: Path,
    output_path: Path,
    start: str,
    end: str | None = None,
    duration: str | None = None,
    on_progress: ProgressCallback | None = None,
    progress_range: tuple[float, float] = (0.0, 1.0),
) -> None:
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

    seg_duration = None
    if on_progress:
        if end:
            seg_duration = _time_to_seconds(end) - _time_to_seconds(start)
        elif duration:
            seg_duration = _time_to_seconds(duration)

    _run_ffmpeg_progress(cmd, seg_duration, on_progress, *progress_range)


def combine_segments(
    input_path: Path,
    segments: list[tuple[str, str]],
    output_path: Path,
    on_progress: ProgressCallback | None = None,
) -> None:
    """Découpe plusieurs segments d'un même fichier puis les concatène en un seul."""
    if not segments:
        raise ValueError("Aucun segment fourni.")

    durations = [max(_time_to_seconds(e) - _time_to_seconds(s), 0.01) for s, e in segments]
    total = sum(durations)
    # La passe de concaténation finale (stream copy) est quasi instantanée : on lui
    # réserve une petite marge et le reste est distribué au prorata de chaque segment.
    trim_budget = 0.95 if on_progress else 1.0

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        part_paths = []
        cursor = 0.0

        for i, ((start, end), dur) in enumerate(zip(segments, durations)):
            part_path = tmp_dir / f"part_{i}{input_path.suffix}"
            span = (dur / total) * trim_budget
            trim_media(input_path, part_path, start, end, on_progress=on_progress, progress_range=(cursor, cursor + span))
            cursor += span
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

        if on_progress:
            on_progress(1.0)


def main() -> None:
    parser = argparse.ArgumentParser(description="Découper un segment d'un fichier audio ou vidéo")
    parser.add_argument("media", type=Path, help="Chemin du fichier source")
    parser.add_argument("-s", "--start", default="00:00:00", help="Temps de début (HH:MM:SS, défaut: 00:00:00)")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("-e", "--end", default=None, help="Temps de fin (HH:MM:SS)")
    group.add_argument("-d", "--duration", default=None, help="Durée du segment (HH:MM:SS)")
    parser.add_argument(
        "--segment", nargs=2, metavar=("START", "END"), action="append", default=None,
        help="Segment à combiner (répétable). Si fourni, découpe et concatène tous les segments.",
    )
    parser.add_argument("-o", "--output", type=Path, default=None, help="Chemin du fichier de sortie")
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        sys.exit("Erreur : ffmpeg introuvable dans le PATH.")

    if not args.media.exists():
        sys.exit(f"Erreur : le fichier '{args.media}' n'existe pas.")

    times_to_check = [("--start", args.start), ("--end", args.end), ("--duration", args.duration)]
    if args.segment:
        for start, end in args.segment:
            times_to_check += [("--segment", start), ("--segment", end)]

    for label, value in times_to_check:
        if value and not is_valid_time(value):
            sys.exit(f"Erreur : format de temps invalide pour {label} ('{value}'). Utiliser HH:MM:SS.")

    def print_progress(frac: float) -> None:
        bar_width = 30
        filled = int(bar_width * frac)
        bar = "#" * filled + "-" * (bar_width - filled)
        print(f"\r[{bar}] {frac * 100:5.1f}%", end="", flush=True)

    if args.segment:
        output_path = args.output or args.media.with_stem(args.media.stem + "_combined")
        try:
            combine_segments(args.media, [tuple(s) for s in args.segment], output_path, print_progress)
        except RuntimeError as e:
            print()
            sys.exit(f"Erreur ffmpeg : {e}")
        print(f"\nSegments combinés : {output_path}")
        return

    output_path = args.output or args.media.with_stem(args.media.stem + "_trim")

    try:
        trim_media(args.media, output_path, args.start, args.end, args.duration, print_progress)
    except RuntimeError as e:
        print()
        sys.exit(f"Erreur ffmpeg : {e}")

    print(f"\nSegment découpé : {output_path}")


if __name__ == "__main__":
    main()
