#!/usr/bin/env python3
"""Modifie la vitesse d'un média (globalement ou par morceaux) via ffmpeg."""

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


def time_to_seconds(value: str) -> float:
    parts = [float(p) for p in value.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0.0)
    h, m, s = parts
    return h * 3600 + m * 60 + s


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
    fraction globale [start, end] (permet de composer plusieurs segments en un seul suivi).

    `seg_duration` doit être la durée de SORTIE attendue (out_time suit la timeline
    post-filtre) : à vitesse x2, elle vaut la moitié de la durée du segment source.
    """
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
    on_progress: ProgressCallback | None = None,
    progress_range: tuple[float, float] = (0.0, 1.0),
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

    # -progress rapporte out_time sur la timeline de SORTIE (après le filtre de vitesse) :
    # on divise donc la durée source par le facteur pour obtenir la durée attendue.
    if on_progress:
        if start and end:
            raw_duration = time_to_seconds(end) - time_to_seconds(start)
        else:
            raw_duration = probe_duration(input_path)
        seg_duration = (raw_duration / factor) if raw_duration else None
    else:
        seg_duration = None

    _run_ffmpeg_progress(cmd, seg_duration, on_progress, *progress_range)


def speed_segments(
    input_path: Path, segments: list[dict], output_path: Path, on_progress: ProgressCallback | None = None
) -> None:
    """segments: [{"start": str, "end": str, "factor": float}, ...] — vitesse propre à chaque morceau."""
    if not segments:
        raise ValueError("Aucun segment fourni.")

    durations = [max(time_to_seconds(s["end"]) - time_to_seconds(s["start"]), 0.01) for s in segments]
    total = sum(durations)
    trim_budget = 0.95 if on_progress else 1.0

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        part_paths = []
        cursor = 0.0

        for i, (seg, dur) in enumerate(zip(segments, durations)):
            part_path = tmp_dir / f"part_{i}{input_path.suffix}"
            span = (dur / total) * trim_budget
            change_speed(
                input_path, part_path, seg["factor"], seg["start"], seg["end"],
                on_progress=on_progress, progress_range=(cursor, cursor + span),
            )
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

    def print_progress(frac: float) -> None:
        bar_width = 30
        filled = int(bar_width * frac)
        bar = "#" * filled + "-" * (bar_width - filled)
        print(f"\r[{bar}] {frac * 100:5.1f}%", end="", flush=True)

    if args.segment:
        segments = []
        for start, end, factor in args.segment:
            if not is_valid_time(start) or not is_valid_time(end):
                sys.exit(f"Erreur : format de temps invalide ('{start}', '{end}'). Utiliser HH:MM:SS.")
            segments.append({"start": start, "end": end, "factor": float(factor)})

        output_path = args.output or args.media.with_stem(args.media.stem + "_speed")
        try:
            speed_segments(args.media, segments, output_path, print_progress)
        except RuntimeError as e:
            print()
            sys.exit(f"Erreur ffmpeg : {e}")
        print(f"\nVitesse appliquée par morceaux : {output_path}")
        return

    output_path = args.output or args.media.with_stem(args.media.stem + "_speed")
    try:
        change_speed(args.media, output_path, args.factor, on_progress=print_progress)
    except RuntimeError as e:
        print()
        sys.exit(f"Erreur ffmpeg : {e}")

    print(f"\nVitesse modifiée ({args.factor}x) : {output_path}")


if __name__ == "__main__":
    main()
