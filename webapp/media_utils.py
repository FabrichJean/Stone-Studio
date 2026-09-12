"""Sondage média et génération de miniatures pour le catalogue de projets."""

import json
import subprocess
from pathlib import Path

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi", ".webm"}


def probe_media(path: Path) -> dict:
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-show_entries", "format=duration",
        "-of", "json", str(path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return {"media_type": "other", "duration": None, "width": None, "height": None}

    data = json.loads(result.stdout)
    duration = data.get("format", {}).get("duration")
    duration = float(duration) if duration else None

    streams = data.get("streams", [])
    if streams:
        width = streams[0].get("width")
        height = streams[0].get("height")
        media_type = "video"
    else:
        width = height = None
        media_type = "audio" if path.suffix.lower() not in VIDEO_EXTS else "video"

    return {"media_type": media_type, "duration": duration, "width": width, "height": height}


def _ffmpeg_frame_ok(cmd: list[str], output_path: Path) -> bool:
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.returncode == 0 and output_path.exists() and output_path.stat().st_size > 0


def generate_thumbnail(input_path: Path, output_path: Path, duration: float | None) -> bool:
    at = min(1.0, duration / 3) if duration else 0.5
    cmd = [
        "ffmpeg", "-y", "-ss", str(at), "-i", str(input_path),
        "-frames:v", "1", "-vf", "scale=320:-1",
        str(output_path),
    ]
    if _ffmpeg_frame_ok(cmd, output_path):
        return True
    if at == 0:
        return False

    # Repli : le point de capture visé (souvent ~1/3 de la durée mesurée) peut tomber hors de
    # portée quand la durée réelle diverge de celle probée (fréquent juste après finalisation
    # d'un enregistrement) — on retente sur la toute première image, presque toujours valide.
    fallback_cmd = [
        "ffmpeg", "-y", "-ss", "0", "-i", str(input_path),
        "-frames:v", "1", "-vf", "scale=320:-1",
        str(output_path),
    ]
    return _ffmpeg_frame_ok(fallback_cmd, output_path)


FILMSTRIP_FRAMES = 6


def generate_filmstrip(input_path: Path, output_path: Path, duration: float | None) -> bool:
    """Génère une bande de vignettes (plusieurs images extraites régulièrement, mises côte à
    côte en une seule image) pour donner un aperçu séquentiel du clip dans la timeline."""
    if not duration or duration <= 0:
        duration = 1.0
    n = FILMSTRIP_FRAMES

    # Une recherche rapide (-ss avant -i) par image voulue : ffmpeg saute directement à chaque
    # position au lieu de décoder tout le fichier image par image. Sur un enregistrement de
    # plusieurs minutes, ça ramène la génération de plusieurs secondes à quasi instantané.
    times = [duration * (i + 0.5) / n for i in range(n)]
    cmd = ["ffmpeg", "-y"]
    for t in times:
        cmd += ["-ss", f"{max(0.0, t):.3f}", "-i", str(input_path)]

    filter_parts = [f"[{i}:v]scale=120:-1[v{i}]" for i in range(n)]
    filter_parts.append("".join(f"[v{i}]" for i in range(n)) + f"hstack=inputs={n}[out]")
    cmd += ["-filter_complex", ";".join(filter_parts), "-frames:v", "1", "-map", "[out]", str(output_path)]

    if _ffmpeg_frame_ok(cmd, output_path):
        return True

    # Repli : la recherche multiple peut échouer sur certains conteneurs à l'index approximatif
    # (ex: enregistrement webm/mp4 tout juste finalisé) — on retente avec l'ancienne méthode
    # par décodage séquentiel, plus lente mais plus tolérante.
    fps = n / duration
    fallback_cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-vf", f"fps={fps},scale=120:-1,tile={n}x1",
        "-frames:v", "1",
        str(output_path),
    ]
    return _ffmpeg_frame_ok(fallback_cmd, output_path)
