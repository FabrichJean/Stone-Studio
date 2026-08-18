#!/usr/bin/env python3
"""Modifie l'orientation d'une vidéo (rotation, miroir) via ffmpeg — globalement ou par morceaux.

Les actions peuvent être combinées (ex: rotation 90° + miroir horizontal) en les
enchaînant dans le graphe de filtres, dans l'ordre fourni.
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

TIME_RE = re.compile(r"^(\d{1,2}:)?(\d{1,2}:)?\d{1,2}(\.\d+)?$")

ACTIONS = {
    "rotate_90_cw": "transpose=1",
    "rotate_90_ccw": "transpose=2",
    "rotate_180": "transpose=1,transpose=1",
    "flip_horizontal": "hflip",
    "flip_vertical": "vflip",
}

ASPECT_RATIOS = {
    "landscape_16_9": (16, 9),
    "portrait_9_16": (9, 16),
    "square_1_1": (1, 1),
    "portrait_4_5": (4, 5),
}


def is_valid_time(value: str) -> bool:
    return bool(TIME_RE.match(value))


def time_to_seconds(value: str) -> float:
    parts = [float(p) for p in value.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0.0)
    h, m, s = parts
    return h * 3600 + m * 60 + s


def probe_dimensions(path: Path) -> tuple[int, int]:
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "json", str(path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())
    stream = json.loads(result.stdout)["streams"][0]
    return stream["width"], stream["height"]


def change_orientation(
    input_path: Path,
    output_path: Path,
    actions: list[str],
    start: str | None = None,
    end: str | None = None,
) -> None:
    if not actions:
        raise ValueError("Au moins une action est requise.")
    for action in actions:
        if action not in ACTIONS:
            raise ValueError(f"Action inconnue : {action}. Choix possibles : {', '.join(ACTIONS)}")

    video_filter = ",".join(ACTIONS[a] for a in actions)
    audio_filter = None

    # Le trim est fait dans le graphe de filtres plutôt que via -ss/-to : combiner -ss/-to
    # (seek "accurate" en option de sortie) avec un filtre vidéo personnalisé fait que ffmpeg
    # ignore silencieusement ce filtre dans certaines versions.
    if start or end:
        bounds = []
        if start:
            bounds.append(f"start={time_to_seconds(start)}")
        if end:
            bounds.append(f"end={time_to_seconds(end)}")
        trim_expr = ":".join(bounds)
        video_filter = f"trim={trim_expr},setpts=PTS-STARTPTS,{video_filter}"
        audio_filter = f"atrim={trim_expr},asetpts=PTS-STARTPTS"

    cmd = ["ffmpeg", "-y", "-i", str(input_path), "-vf", video_filter]

    if audio_filter:
        cmd += ["-filter:a", audio_filter, "-c:a", "aac"]
    else:
        cmd += ["-c:a", "copy"]

    cmd += ["-c:v", "libx264", "-preset", "fast", "-crf", "18", str(output_path)]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())


def apply_aspect_ratio(input_path: Path, output_path: Path, ratio_key: str, pos: float = 0.5) -> None:
    """Recadre (crop, sans déformation) au format d'affichage choisi.

    `pos` (0..1) place le recadrage le long de l'axe rogné : 0 = gauche/haut,
    0.5 = centré (défaut), 1 = droite/bas.
    """
    if ratio_key not in ASPECT_RATIOS:
        raise ValueError(f"Format inconnu : {ratio_key}. Choix possibles : {', '.join(ASPECT_RATIOS)}")

    pos = max(0.0, min(1.0, pos))
    rw, rh = ASPECT_RATIOS[ratio_key]
    r = rw / rh
    crop_filter = (
        f"crop=w='if(gt(iw/ih,{r}),ih*{r},iw)':h='if(gt(iw/ih,{r}),ih,iw/{r})':"
        f"x='(iw-out_w)*{pos}':y='(ih-out_h)*{pos}'"
    )

    cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-vf", crop_filter,
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-c:a", "copy",
        str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())


def orient_segments(input_path: Path, segments: list[dict], output_path: Path) -> None:
    """segments: [{"start": str, "end": str, "actions": list[str]}, ...] — orientation(s)
    propre(s) à chaque morceau (une ou plusieurs actions combinées).

    Des morceaux avec des rotations différentes (90° vs 180°/miroir) produisent des
    dimensions différentes : on harmonise sur la plus grande taille (scale + pad) avant
    de concaténer via un filtre plutôt qu'un simple stream copy.
    """
    if not segments:
        raise ValueError("Aucun segment fourni.")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        part_paths = []

        for i, seg in enumerate(segments):
            part_path = tmp_dir / f"part_{i}{input_path.suffix}"
            change_orientation(input_path, part_path, seg["actions"], seg.get("start"), seg.get("end"))
            part_paths.append(part_path)

        dims = [probe_dimensions(p) for p in part_paths]
        target_w = max(w for w, _ in dims)
        target_h = max(h for _, h in dims)
        target_w += target_w % 2
        target_h += target_h % 2

        inputs = []
        filter_parts = []
        for i, part_path in enumerate(part_paths):
            inputs += ["-i", str(part_path)]
            filter_parts.append(
                f"[{i}:v]scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
                f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2,setsar=1[v{i}]"
            )

        concat_inputs = "".join(f"[v{i}][{i}:a]" for i in range(len(part_paths)))
        filter_complex = ";".join(filter_parts) + f";{concat_inputs}concat=n={len(part_paths)}:v=1:a=1[outv][outa]"

        cmd = [
            "ffmpeg", "-y", *inputs,
            "-filter_complex", filter_complex,
            "-map", "[outv]", "-map", "[outa]",
            "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-c:a", "aac",
            str(output_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip())


def main() -> None:
    parser = argparse.ArgumentParser(description="Modifier l'orientation d'une vidéo")
    parser.add_argument("video", type=Path, help="Chemin du fichier vidéo source")
    parser.add_argument(
        "-a", "--action", choices=ACTIONS, action="append", default=None,
        help="Action d'orientation globale (répétable pour combiner, ex: -a rotate_90_cw -a flip_horizontal)",
    )
    parser.add_argument(
        "--segment", nargs=3, metavar=("START", "END", "ACTIONS"), action="append", default=None,
        help="Segment avec ses propres actions (répétable) : START END ACTIONS "
             "(ACTIONS séparées par des virgules, ex: rotate_90_cw,flip_horizontal)",
    )
    parser.add_argument("-o", "--output", type=Path, default=None, help="Chemin du fichier de sortie")
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        sys.exit("Erreur : ffmpeg introuvable dans le PATH.")
    if not args.video.exists():
        sys.exit(f"Erreur : le fichier '{args.video}' n'existe pas.")

    if args.segment:
        segments = []
        for start, end, actions_str in args.segment:
            if not is_valid_time(start) or not is_valid_time(end):
                sys.exit(f"Erreur : format de temps invalide ('{start}', '{end}'). Utiliser HH:MM:SS.")
            actions = actions_str.split(",")
            for action in actions:
                if action not in ACTIONS:
                    sys.exit(f"Erreur : action inconnue '{action}'.")
            segments.append({"start": start, "end": end, "actions": actions})

        output_path = args.output or args.video.with_stem(args.video.stem + "_orientation")
        try:
            orient_segments(args.video, segments, output_path)
        except RuntimeError as e:
            sys.exit(f"Erreur ffmpeg : {e}")
        print(f"Orientation appliquée par morceaux : {output_path}")
        return

    if not args.action:
        sys.exit("Erreur : préciser au moins un --action ou un --segment.")

    output_path = args.output or args.video.with_stem(args.video.stem + "_orientation")

    try:
        change_orientation(args.video, output_path, args.action)
    except RuntimeError as e:
        sys.exit(f"Erreur ffmpeg : {e}")

    print(f"Orientation modifiée ({'+'.join(args.action)}) : {output_path}")


if __name__ == "__main__":
    main()
