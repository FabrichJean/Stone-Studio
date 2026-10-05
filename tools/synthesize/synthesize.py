#!/usr/bin/env python3
"""Génère des médias entièrement synthétiques via les sources et filtres audio/vidéo ffmpeg
lavfi : textures génératives (fractales, automates cellulaires...), tonalités et paysages
sonores procéduraux, et visualiseurs qui transforment un audio existant en vidéo réactive.
Aucun modèle externe — tout est calculé par ffmpeg lui-même."""

import argparse
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable

from melody import MELODY_KEYS, MELODY_LAYERS, MELODY_SCALES, MELODY_TIMBRES, MelodyError, generate_melody

ProgressCallback = Callable[[float], None]

TIME_RE = re.compile(r"^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$")

ASPECTS = {
    "landscape": (1280, 720),
    "portrait": (720, 1280),
    "square": (960, 960),
}

TEXTURE_PRESETS = {
    "life": {
        "label": "Vie cellulaire",
        "description": "Automate de Conway : des colonies naissent, prospèrent et s'éteignent sans jamais se répéter.",
    },
    "mandelbrot": {
        "label": "Fractale Mandelbrot",
        "description": "Zoom continu dans une fractale — abstrait, hypnotique, jamais deux fois pareil.",
    },
    "cellauto": {
        "label": "Automate cellulaire",
        "description": "Motif tissé par un automate élémentaire (règle 110) qui défile à l'infini.",
    },
    "gradients": {
        "label": "Dégradés animés",
        "description": "Nappes de couleur qui dérivent lentement — discret, apaisant, en fond.",
    },
    "sierpinski": {
        "label": "Fractale Sierpinski",
        "description": "Triangle fractal scintillant, motif géométrique en boucle continue.",
    },
}

TONE_PRESETS = {
    "tone": {"label": "Tonalité pure", "description": "Une seule fréquence, note propre et stable."},
    "chord": {"label": "Accord", "description": "Trois fréquences empilées en triade, majeure ou mineure."},
    "binaural": {"label": "Battements binauraux", "description": "Deux fréquences proches, une par oreille — casque recommandé."},
    "noise": {"label": "Bruit coloré", "description": "Blanc, rose ou brun — texture d'ambiance ou de test."},
}

NOISE_COLORS = {"white": "Blanc", "pink": "Rose", "brown": "Brun"}

VISUALIZER_PRESETS = {
    "waves": {"label": "Onde", "description": "Forme d'onde classique, épurée, au rythme du signal."},
    "spectrum": {"label": "Spectre", "description": "Analyse fréquentielle colorée, façon égaliseur de studio."},
    "cqt": {"label": "Piano chromatique", "description": "Barres façon clavier — révèle les notes réellement jouées."},
    "vectorscope": {"label": "Vectorscope", "description": "Motif organique qui réagit à l'image stéréo du son."},
}


class SynthesizeError(RuntimeError):
    pass


def generate_melody_wrapped(
    source_path: Path, key: str, scale: str, timbre: str, output_path: Path,
    layers: set[str] | None = None, on_progress: ProgressCallback | None = None,
) -> None:
    """Enveloppe `melody.generate_melody` en gérant son dossier de travail et en unifiant ses
    erreurs sous `SynthesizeError`, comme les autres générateurs de ce module."""
    try:
        with tempfile.TemporaryDirectory() as tmp:
            generate_melody(source_path, key, scale, timbre, output_path, Path(tmp), layers, on_progress)
    except MelodyError as e:
        raise SynthesizeError(str(e)) from e


def _parse_out_time(value: str) -> float | None:
    match = TIME_RE.match(value)
    if not match:
        return None
    h, m, s = match.groups()
    return int(h) * 3600 + int(m) * 60 + float(s)


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


def _run_ffmpeg_progress(cmd: list[str], duration: float, on_progress: ProgressCallback | None) -> None:
    full_cmd = cmd + ["-progress", "pipe:1", "-nostats"]
    proc = subprocess.Popen(full_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.strip()
        if not line.startswith("out_time="):
            continue
        elapsed = _parse_out_time(line.split("=", 1)[1])
        if elapsed is not None and duration and on_progress:
            on_progress(max(0.0, min(elapsed / duration, 1.0)))

    stderr = proc.stderr.read() if proc.stderr else ""
    proc.wait()
    if proc.returncode != 0:
        raise SynthesizeError(stderr.strip()[-400:])
    if on_progress:
        on_progress(1.0)


def generate_texture(
    preset: str, duration: float, aspect: str, output_path: Path,
    on_progress: ProgressCallback | None = None,
) -> None:
    """Rend `duration` secondes d'une texture visuelle purement générative — aucune entrée,
    juste une source ffmpeg lavfi animée dans le temps."""
    if preset not in TEXTURE_PRESETS:
        raise SynthesizeError(f"Preset de texture inconnu : {preset}")
    if aspect not in ASPECTS:
        raise SynthesizeError(f"Format d'image inconnu : {aspect}")
    width, height = ASPECTS[aspect]
    size = f"{width}x{height}"

    sources = {
        "life": f"life=size={size}:mold=10:rate=25:ratio=0.4:death_color=#14121a:life_color=#d97757",
        "mandelbrot": f"mandelbrot=size={size}:rate=25",
        "cellauto": f"cellauto=size={size}:rule=110:scroll=1:rate=25",
        "gradients": f"gradients=size={size}:rate=25:speed=0.02:nb_colors=5",
        "sierpinski": f"sierpinski=size={size}:rate=25",
    }
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", sources[preset],
        "-t", str(duration),
        "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
        str(output_path),
    ]
    _run_ffmpeg_progress(cmd, duration, on_progress)


def generate_tone(
    preset: str, duration: float, params: dict, output_path: Path,
    on_progress: ProgressCallback | None = None,
) -> None:
    """Rend `duration` secondes d'un son entièrement synthétisé — aucune entrée, uniquement des
    oscillateurs (sine) ou une source de bruit coloré (anoisesrc) combinés au besoin."""
    if preset not in TONE_PRESETS:
        raise SynthesizeError(f"Preset de tonalité inconnu : {preset}")

    if preset == "tone":
        freq = max(20.0, float(params.get("frequency", 440)))
        cmd = [
            "ffmpeg", "-y", "-f", "lavfi", "-i", f"sine=frequency={freq}:sample_rate=44100",
            "-t", str(duration), "-c:a", "aac", str(output_path),
        ]
    elif preset == "chord":
        root = max(20.0, float(params.get("frequency", 261.63)))
        minor = bool(params.get("minor", False))
        third = root * (2 ** ((3 if minor else 4) / 12))
        fifth = root * (2 ** (7 / 12))
        cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", f"sine=frequency={root}:sample_rate=44100",
            "-f", "lavfi", "-i", f"sine=frequency={third}:sample_rate=44100",
            "-f", "lavfi", "-i", f"sine=frequency={fifth}:sample_rate=44100",
            "-filter_complex", "[0:a][1:a][2:a]amix=inputs=3:duration=first,volume=2.0",
            "-t", str(duration), "-c:a", "aac", str(output_path),
        ]
    elif preset == "binaural":
        base = max(20.0, float(params.get("frequency", 200)))
        beat = max(0.5, min(40.0, float(params.get("beat", 10))))
        cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", f"sine=frequency={base}:sample_rate=44100",
            "-f", "lavfi", "-i", f"sine=frequency={base + beat}:sample_rate=44100",
            "-filter_complex", "[0:a][1:a]join=inputs=2:channel_layout=stereo[aout]",
            "-map", "[aout]", "-t", str(duration), "-c:a", "aac", str(output_path),
        ]
    else:  # noise
        color = params.get("color", "pink")
        if color not in NOISE_COLORS:
            color = "pink"
        cmd = [
            "ffmpeg", "-y", "-f", "lavfi", "-i", f"anoisesrc=color={color}:sample_rate=44100:amplitude=0.4",
            "-t", str(duration), "-c:a", "aac", str(output_path),
        ]

    _run_ffmpeg_progress(cmd, duration, on_progress)


def generate_visualizer(
    preset: str, audio_path: Path, aspect: str, output_path: Path,
    on_progress: ProgressCallback | None = None,
) -> None:
    """Transforme un audio existant en vidéo : le visuel est entièrement dérivé du signal
    (aucune image d'entrée), et la piste audio d'origine est conservée telle quelle."""
    if preset not in VISUALIZER_PRESETS:
        raise SynthesizeError(f"Preset de visualiseur inconnu : {preset}")
    if aspect not in ASPECTS:
        raise SynthesizeError(f"Format d'image inconnu : {aspect}")
    width, height = ASPECTS[aspect]
    size = f"{width}x{height}"

    filters = {
        "waves": f"showwaves=s={size}:mode=cline:colors=#d97757,format=yuv420p",
        "spectrum": f"showspectrum=s={size}:mode=combined:color=intensity:scale=cbrt,format=yuv420p",
        "cqt": f"showcqt=s={size},format=yuv420p",
        "vectorscope": f"avectorscope=s={size}:zoom=1.5,format=yuv420p",
    }
    duration = _probe_duration(audio_path)
    cmd = [
        "ffmpeg", "-y", "-i", str(audio_path),
        "-filter_complex", f"[0:a]{filters[preset]}[v]",
        "-map", "[v]", "-map", "0:a",
        "-c:v", "libx264", "-preset", "fast", "-crf", "20",
        "-c:a", "aac", "-shortest",
        str(output_path),
    ]
    _run_ffmpeg_progress(cmd, duration, on_progress)


def main() -> None:
    parser = argparse.ArgumentParser(description="Générer un média synthétique")
    sub = parser.add_subparsers(dest="kind", required=True)

    p_texture = sub.add_parser("texture", help="Texture visuelle générative")
    p_texture.add_argument("preset", choices=TEXTURE_PRESETS)
    p_texture.add_argument("-d", "--duration", type=float, default=6.0)
    p_texture.add_argument("-a", "--aspect", choices=ASPECTS, default="landscape")
    p_texture.add_argument("-o", "--output", type=Path, required=True)

    p_tone = sub.add_parser("tone", help="Tonalité/paysage sonore synthétique")
    p_tone.add_argument("preset", choices=TONE_PRESETS)
    p_tone.add_argument("-d", "--duration", type=float, default=6.0)
    p_tone.add_argument("-f", "--frequency", type=float, default=440.0)
    p_tone.add_argument("-o", "--output", type=Path, required=True)

    p_vis = sub.add_parser("visualizer", help="Visualiseur audio → vidéo")
    p_vis.add_argument("preset", choices=VISUALIZER_PRESETS)
    p_vis.add_argument("audio", type=Path)
    p_vis.add_argument("-a", "--aspect", choices=ASPECTS, default="landscape")
    p_vis.add_argument("-o", "--output", type=Path, required=True)

    p_mel = sub.add_parser("melody", help="Mélodie synthétique extraite d'un audio/vidéo")
    p_mel.add_argument("source", type=Path)
    p_mel.add_argument("-k", "--key", choices=MELODY_KEYS, default="C")
    p_mel.add_argument("-s", "--scale", choices=MELODY_SCALES, default="major")
    p_mel.add_argument("-t", "--timbre", choices=MELODY_TIMBRES, default="piano")
    p_mel.add_argument(
        "-l", "--layers", nargs="*", choices=MELODY_LAYERS, default=[],
        help="Couches d'accompagnement à ajouter (bass, pad, drums — combinables ou aucune)",
    )
    p_mel.add_argument("-o", "--output", type=Path, required=True)

    args = parser.parse_args()

    def print_progress(frac: float) -> None:
        bar_width = 30
        filled = int(bar_width * frac)
        bar = "#" * filled + "-" * (bar_width - filled)
        print(f"\r[{bar}] {frac * 100:5.1f}%", end="", flush=True)

    try:
        if args.kind == "texture":
            generate_texture(args.preset, args.duration, args.aspect, args.output, print_progress)
        elif args.kind == "tone":
            generate_tone(args.preset, args.duration, {"frequency": args.frequency}, args.output, print_progress)
        elif args.kind == "visualizer":
            generate_visualizer(args.preset, args.audio, args.aspect, args.output, print_progress)
        else:
            generate_melody_wrapped(args.source, args.key, args.scale, args.timbre, args.output, set(args.layers), print_progress)
    except SynthesizeError as e:
        print()
        sys.exit(f"Erreur : {e}")

    print(f"\nMédia synthétisé : {args.output}")


if __name__ == "__main__":
    main()
