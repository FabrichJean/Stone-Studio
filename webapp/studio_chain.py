#!/usr/bin/env python3
"""Exécute une chaîne d'actions Studio en séquence : la sortie de chaque étape devient
l'entrée de la suivante, en réutilisant directement les fonctions ffmpeg des outils."""

import subprocess
import sys
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parent.parent
for _pkg in ("extract_audio", "trim_media", "speed_media", "orientation", "noise_removal", "compress_media"):
    sys.path.insert(0, str(ROOT / "tools" / _pkg))

from extract_audio import extract_audio  # noqa: E402
from trim_media import combine_segments, trim_media  # noqa: E402
from speed_media import change_speed, speed_segments  # noqa: E402
from orientation import change_orientation, orient_segments  # noqa: E402
from compress_media import compress_video  # noqa: E402
from noise_removal import remove_noise  # noqa: E402

ProgressCallback = Callable[[float], None]

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi", ".webm"}
AUDIO_EXTS = {".mp3", ".wav", ".aac", ".flac", ".m4a"}

STEP_LABELS = {
    "trim": "Découpage",
    "speed": "Vitesse",
    "orientation": "Screen",
    "compress": "Compression",
    "extract_audio": "Audio",
    "noise_removal": "Suppression bruit",
}

# Ces étapes exigent un flux vidéo : si "Audio" (extraction) tourne avant elles dans la
# chaîne, le curseur devient un fichier audio et ces étapes ne peuvent plus s'appliquer.
VIDEO_ONLY_STEPS = {"orientation", "compress"}


class ChainError(RuntimeError):
    pass


def _run_trim(inp: Path, out: Path, params: dict, on_progress: ProgressCallback | None) -> None:
    if params.get("mode") == "segments":
        segments = params.get("segments") or []
        if not segments:
            raise ChainError("Découpage : ajoutez au moins un morceau.")
        combine_segments(inp, [(s["start"], s["end"]) for s in segments], out, on_progress=on_progress)
        return
    if not params.get("start"):
        raise ChainError("Découpage : un point de départ est requis.")
    trim_media(inp, out, params["start"], params.get("end") or None, on_progress=on_progress)


def _run_speed(inp: Path, out: Path, params: dict, on_progress: ProgressCallback | None) -> None:
    if params.get("mode") == "segments":
        segments = params.get("segments") or []
        if not segments:
            raise ChainError("Vitesse : ajoutez au moins un morceau.")
        speed_segments(inp, segments, out, on_progress=on_progress)
        return
    change_speed(inp, out, float(params.get("factor", 1)), on_progress=on_progress)


def _run_orientation(inp: Path, out: Path, params: dict, on_progress: ProgressCallback | None) -> None:
    if params.get("mode") == "segments":
        segments = params.get("segments") or []
        if not segments:
            raise ChainError("Screen : ajoutez au moins un morceau.")
        orient_segments(inp, segments, out, on_progress=on_progress, keep_full=bool(params.get("keep_full", False)))
        return
    actions = params.get("actions") or []
    aspect_ratio = params.get("aspect_ratio") or None
    crop_rect = params.get("crop_rect") or None
    zoom_rect = params.get("zoom_rect") or None
    if not actions and not aspect_ratio and not crop_rect and not zoom_rect:
        raise ChainError("Screen : choisissez au moins une rotation, un zoom ou un format d'affichage.")
    change_orientation(
        inp, out, actions,
        aspect_ratio=aspect_ratio,
        aspect_position=float(params.get("aspect_position", 0.5)),
        crop_rect=crop_rect,
        zoom_rect=zoom_rect,
        zoom_animated=bool(params.get("zoom_animated", False)),
        on_progress=on_progress,
    )


def _run_compress(inp: Path, out: Path, params: dict, on_progress: ProgressCallback | None) -> None:
    max_size_mb = params.get("max_size_mb")
    compress_video(
        inp, out,
        params.get("level", "medium"),
        params.get("resolution", "original"),
        float(max_size_mb) if max_size_mb else None,
        on_progress=on_progress,
    )


def _run_extract_audio(inp: Path, out: Path, params: dict, on_progress: ProgressCallback | None) -> None:
    extract_audio(
        inp, out,
        params.get("format", "mp3"),
        params.get("bitrate") or None,
        params.get("channels") or None,
        int(params["sample_rate"]) if params.get("sample_rate") else None,
        on_progress=on_progress,
    )


def _run_noise_removal(inp: Path, out: Path, params: dict, on_progress: ProgressCallback | None) -> None:
    remove_noise(inp, out, params.get("level", "medium"), bool(params.get("reduce_hum", False)))
    if on_progress:
        on_progress(1.0)


RUNNERS = {
    "trim": _run_trim,
    "speed": _run_speed,
    "orientation": _run_orientation,
    "compress": _run_compress,
    "extract_audio": _run_extract_audio,
    "noise_removal": _run_noise_removal,
}


def run_chain(
    input_path: Path, chain: list[dict], workdir: Path, on_progress: ProgressCallback | None = None
) -> Path:
    """Applique chaque action activée de `chain`, dans l'ordre, à partir de `input_path`.
    Retourne le chemin du fichier final (à l'intérieur de `workdir`)."""
    steps = [s for s in chain if s.get("enabled", True)]
    if not steps:
        raise ChainError("La chaîne ne contient aucune action.")

    cursor = input_path
    total = len(steps)

    for i, step in enumerate(steps):
        step_type = step.get("type")
        runner = RUNNERS.get(step_type)
        if not runner:
            raise ChainError(f"Action inconnue : {step_type}")

        if step_type in VIDEO_ONLY_STEPS and cursor.suffix.lower() not in VIDEO_EXTS:
            label = STEP_LABELS.get(step_type, step_type)
            raise ChainError(
                f"« {label} » nécessite une vidéo, mais une étape précédente a produit un fichier audio."
            )

        params = step.get("params") or {}
        ext = f".{params['format']}" if step_type == "extract_audio" else cursor.suffix
        out_path = workdir / f"step_{i}{ext}"

        seg_start, seg_end = i / total, (i + 1) / total

        def wrapped(frac: float, seg_start=seg_start, seg_end=seg_end) -> None:
            if on_progress:
                on_progress(seg_start + frac * (seg_end - seg_start))

        try:
            runner(cursor, out_path, params, wrapped if on_progress else None)
        except ChainError:
            raise
        except Exception as e:
            # N'importe quelle exception (ValueError d'un outil, etc.) doit devenir une
            # ChainError : sinon elle remonte hors du thread d'arrière-plan sans jamais
            # marquer le job en erreur, et le frontend reste bloqué à sonder indéfiniment.
            label = STEP_LABELS.get(step_type, step_type)
            raise ChainError(f"« {label} » a échoué : {e}") from e

        cursor = out_path

    if on_progress:
        on_progress(1.0)
    return cursor


def _probe_dimensions(path: Path) -> tuple[int, int]:
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", str(path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    try:
        w, h = result.stdout.strip().split("x")
        return int(w), int(h)
    except ValueError:
        return (1280, 720)


def _has_audio_stream(path: Path) -> bool:
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "a",
        "-show_entries", "stream=index", "-of", "csv=p=0", str(path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return bool(result.stdout.strip())


def _probe_duration(path: Path) -> float:
    cmd = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return float(result.stdout.strip())
    except ValueError:
        return 1.0


def concat_clips(clip_paths: list[Path], workdir: Path, on_progress: ProgressCallback | None = None) -> Path:
    """Assemble plusieurs clips bout à bout (piste de montage) en un seul fichier final.
    Les clips vidéo sont mis à l'échelle sur les dimensions du premier avant d'être concaténés
    (le filtre concat exige des flux de même résolution)."""
    if not clip_paths:
        raise ChainError("La timeline est vide.")
    if len(clip_paths) == 1:
        if on_progress:
            on_progress(1.0)
        return clip_paths[0]

    exts = {p.suffix.lower() for p in clip_paths}
    all_audio = exts <= AUDIO_EXTS
    all_video = exts <= VIDEO_EXTS
    if not all_audio and not all_video:
        raise ChainError(
            "Impossible d'assembler la timeline : elle mélange des clips vidéo et audio. "
            "Gardez des clips du même type pour l'export."
        )

    n = len(clip_paths)
    cmd = ["ffmpeg", "-y"]
    for p in clip_paths:
        cmd += ["-i", str(p)]

    filter_parts = []
    if all_video:
        target_w, target_h = _probe_dimensions(clip_paths[0])
        # Un clip vidéo peut ne pas avoir de piste audio (ex : enregistrement d'écran sans
        # micro) : le filtre concat exige pourtant le même nombre de flux sur chaque segment,
        # donc on lui fournit une piste silencieuse synthétique de la bonne durée à la place.
        next_input_index = n
        for i, p in enumerate(clip_paths):
            filter_parts.append(f"[{i}:v]scale={target_w}:{target_h},setsar=1[v{i}]")
            if _has_audio_stream(p):
                filter_parts.append(f"[{i}:a]aformat=sample_rates=44100:channel_layouts=stereo[a{i}]")
            else:
                silent_idx = next_input_index
                next_input_index += 1
                cmd += [
                    "-f", "lavfi", "-t", str(_probe_duration(p)),
                    "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
                ]
                filter_parts.append(f"[{silent_idx}:a]aformat=sample_rates=44100:channel_layouts=stereo[a{i}]")
        streams = "".join(f"[v{i}][a{i}]" for i in range(n))
        filter_parts.append(f"{streams}concat=n={n}:v=1:a=1[outv][outa]")
        maps = ["-map", "[outv]", "-map", "[outa]"]
        codec_args = ["-c:v", "libx264", "-preset", "fast", "-crf", "20", "-c:a", "aac"]
        out_path = workdir / "timeline_export.mp4"
    else:
        for i in range(n):
            filter_parts.append(f"[{i}:a]aformat=sample_rates=44100:channel_layouts=stereo[a{i}]")
        streams = "".join(f"[a{i}]" for i in range(n))
        filter_parts.append(f"{streams}concat=n={n}:v=0:a=1[outa]")
        maps = ["-map", "[outa]"]
        codec_args = ["-c:a", "aac"]
        out_path = workdir / "timeline_export.m4a"

    cmd += ["-filter_complex", ";".join(filter_parts), *maps, *codec_args, str(out_path)]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise ChainError(f"L'assemblage de la timeline a échoué : {result.stderr.strip()[-400:]}")

    if on_progress:
        on_progress(1.0)
    return out_path
