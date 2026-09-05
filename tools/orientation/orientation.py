#!/usr/bin/env python3
"""Modifie l'orientation d'une vidéo (rotation, miroir, format d'affichage) via ffmpeg —
globalement ou par morceaux.

Les actions peuvent être combinées (ex: rotation 90° + miroir horizontal) en les
enchaînant dans le graphe de filtres, dans l'ordre fourni. Le format d'affichage
(recadrage) peut être réglé indépendamment, y compris par morceau.
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable

TIME_RE = re.compile(r"^(\d{1,2}:)?(\d{1,2}:)?\d{1,2}(\.\d+)?$")
OUT_TIME_RE = re.compile(r"^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$")

ProgressCallback = Callable[[float], None]

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


def _crop_filter(ratio_key: str, pos: float) -> str:
    """`pos` (0..1) place le recadrage le long de l'axe rogné : 0 = gauche/haut,
    0.5 = centré, 1 = droite/bas."""
    if ratio_key not in ASPECT_RATIOS:
        raise ValueError(f"Format inconnu : {ratio_key}. Choix possibles : {', '.join(ASPECT_RATIOS)}")

    pos = max(0.0, min(1.0, pos))
    rw, rh = ASPECT_RATIOS[ratio_key]
    r = rw / rh
    return (
        f"crop=w='if(gt(iw/ih,{r}),ih*{r},iw)':h='if(gt(iw/ih,{r}),ih,iw/{r})':"
        f"x='(iw-out_w)*{pos}':y='(ih-out_h)*{pos}'"
    )


def _custom_crop_filter(rect: dict) -> str:
    """`rect` donne x, y, w, h en fractions (0..1) de la frame source — un cadre
    dessiné librement par l'utilisateur plutôt qu'un format d'affichage prédéfini."""
    x, y, w, h = rect["x"], rect["y"], rect["w"], rect["h"]
    return (
        f"crop=w='trunc(iw*{w}/2)*2':h='trunc(ih*{h}/2)*2':"
        f"x='trunc(iw*{x})':y='trunc(ih*{y})'"
    )


def _zoom_filter(rect: dict, target_w: int, target_h: int) -> str:
    """Comme `_custom_crop_filter`, mais réagrandit ensuite la zone rognée aux dimensions
    `target_w`x`target_h` (données en pixels, pas en formule ffmpeg : après le crop, `iw`/`ih`
    référencent déjà la taille rognée, pas la taille d'origine) — un vrai effet de zoom/cadrage
    serré, contrairement au format d'affichage qui se contente de réduire la taille du cadre."""
    x, y, w, h = rect["x"], rect["y"], rect["w"], rect["h"]
    return (
        f"crop=w='trunc(iw*{w}/2)*2':h='trunc(ih*{h}/2)*2':"
        f"x='trunc(iw*{x})':y='trunc(ih*{y})',"
        f"scale={target_w}:{target_h}"
    )


ZOOM_TRANSITION_SECONDS = 0.8
ZOOM_TRANSITION_STEPS = 14


def _even(value: float, upper: int) -> int:
    v = int(round(value))
    v -= v % 2
    return max(2, min(v, upper))


def _zoom_crop_box(rect: dict, target_w: int, target_h: int, p: float) -> tuple[int, int, int, int]:
    """Rectangle de crop (en pixels) interpolé entre le cadre complet (p=0) et `rect` (p=1)."""
    x, y, w, h = rect["x"], rect["y"], rect["w"], rect["h"]
    cw = _even(target_w * (1 - p * (1 - w)), target_w)
    ch = _even(target_h * (1 - p * (1 - h)), target_h)
    cx = min(int(round(target_w * x * p)), target_w - cw)
    cy = min(int(round(target_h * y * p)), target_h - ch)
    return cw, ch, cx, cy


def _animated_zoom_graph(
    input_label: str, rect: dict, target_w: int, target_h: int, total_duration: float,
) -> tuple[list[str], str]:
    """Construit un graphe de filtres (`filter_complex`) simulant une transition de zoom
    progressive ("punch-in") : ffmpeg ne permet pas de faire varier les dimensions d'un crop
    frame par frame, donc on approxime la transition par une succession de courts segments à
    crop fixe (un par pas), rognés puis mis à l'échelle, ensuite concaténés. Après la
    transition, la vidéo reste figée sur le cadre `rect` (zoom tenu) jusqu'à `total_duration`."""
    transition = min(ZOOM_TRANSITION_SECONDS, max(total_duration, 0.05))
    steps = ZOOM_TRANSITION_STEPS
    dt = transition / steps

    parts = []
    for i in range(steps):
        t0, t1 = i * dt, (i + 1) * dt
        p = i / (steps - 1) if steps > 1 else 1.0
        cw, ch, cx, cy = _zoom_crop_box(rect, target_w, target_h, p)
        parts.append(
            f"[b{i}]trim=start={t0:.6f}:end={t1:.6f},setpts=PTS-STARTPTS,"
            f"crop={cw}:{ch}:{cx}:{cy},scale={target_w}:{target_h},setsar=1[z{i}]"
        )

    hold_needed = total_duration > transition + 0.05
    n = steps + (1 if hold_needed else 0)
    if hold_needed:
        cw, ch, cx, cy = _zoom_crop_box(rect, target_w, target_h, 1.0)
        parts.append(
            f"[b{steps}]trim=start={transition:.6f}:end={total_duration:.6f},setpts=PTS-STARTPTS,"
            f"crop={cw}:{ch}:{cx}:{cy},scale={target_w}:{target_h},setsar=1[z{steps}]"
        )

    split_labels = "".join(f"[b{i}]" for i in range(n))
    concat_in = "".join(f"[z{i}]" for i in range(n))
    graph = [f"[{input_label}]split={n}{split_labels}", *parts, f"{concat_in}concat=n={n}:v=1:a=0[zoomout]"]
    return graph, "zoomout"


def change_orientation(
    input_path: Path,
    output_path: Path,
    actions: list[str],
    start: str | None = None,
    end: str | None = None,
    aspect_ratio: str | None = None,
    aspect_position: float = 0.5,
    crop_rect: dict | None = None,
    zoom_rect: dict | None = None,
    zoom_animated: bool = False,
    on_progress: ProgressCallback | None = None,
    progress_range: tuple[float, float] = (0.0, 1.0),
) -> None:
    for action in actions:
        if action not in ACTIONS:
            raise ValueError(f"Action inconnue : {action}. Choix possibles : {', '.join(ACTIONS)}")
    if not actions and not aspect_ratio and not crop_rect and not zoom_rect:
        raise ValueError("Au moins une action, un zoom ou un format d'affichage est requis.")

    if start and end:
        seg_duration = time_to_seconds(end) - time_to_seconds(start)
    elif start or end:
        seg_duration = None
    else:
        seg_duration = probe_duration(input_path) if (on_progress or (zoom_rect and zoom_animated)) else None

    audio_filter = None
    trim_expr = None
    if start or end:
        bounds = []
        if start:
            bounds.append(f"start={time_to_seconds(start)}")
        if end:
            bounds.append(f"end={time_to_seconds(end)}")
        trim_expr = ":".join(bounds)
        audio_filter = f"atrim={trim_expr},asetpts=PTS-STARTPTS"

    tail_filters = [ACTIONS[a] for a in actions]
    if crop_rect:
        tail_filters.append(_custom_crop_filter(crop_rect))
    elif aspect_ratio:
        tail_filters.append(_crop_filter(aspect_ratio, aspect_position))

    if zoom_rect and zoom_animated:
        # Une transition de zoom animée ne peut pas s'exprimer comme un simple filtre -vf
        # (ffmpeg ne fait pas varier les dimensions d'un crop frame par frame) : on construit
        # un vrai graphe (-filter_complex) qui découpe le flux en plusieurs segments à crop
        # fixe, rognés/mis à l'échelle puis recollés — voir `_animated_zoom_graph`.
        target_w, target_h = probe_dimensions(input_path)
        total_duration = seg_duration if seg_duration is not None else (probe_duration(input_path) or ZOOM_TRANSITION_SECONDS)

        complex_parts = []
        input_label = "0:v"
        if trim_expr:
            complex_parts.append(f"[0:v]trim={trim_expr},setpts=PTS-STARTPTS[vtrim]")
            input_label = "vtrim"

        zoom_stmts, zoom_out_label = _animated_zoom_graph(input_label, zoom_rect, target_w, target_h, total_duration)
        complex_parts += zoom_stmts

        if tail_filters:
            complex_parts.append(f"[{zoom_out_label}]{','.join(tail_filters)}[outv]")
            final_label = "outv"
        else:
            final_label = zoom_out_label

        cmd = [
            "ffmpeg", "-y", "-i", str(input_path),
            "-filter_complex", ";".join(complex_parts),
            "-map", f"[{final_label}]", "-map", "0:a?",
        ]
        if audio_filter:
            cmd += ["-filter:a", audio_filter, "-c:a", "aac"]
        else:
            cmd += ["-c:a", "copy"]
        cmd += ["-c:v", "libx264", "-preset", "fast", "-crf", "18", str(output_path)]

        _run_ffmpeg_progress(cmd, seg_duration, on_progress, *progress_range)
        return

    filter_parts = []
    if trim_expr:
        filter_parts += [f"trim={trim_expr}", "setpts=PTS-STARTPTS"]

    # Le zoom s'applique en premier (avant rotation/format d'affichage) car ses coordonnées
    # sont exprimées relativement à la frame d'origine, telle que dessinée par l'utilisateur
    # sur l'aperçu non pivoté.
    if zoom_rect:
        target_w, target_h = probe_dimensions(input_path)
        filter_parts.append(_zoom_filter(zoom_rect, target_w, target_h))

    filter_parts += tail_filters

    cmd = ["ffmpeg", "-y", "-i", str(input_path), "-vf", ",".join(filter_parts)]

    if audio_filter:
        cmd += ["-filter:a", audio_filter, "-c:a", "aac"]
    else:
        cmd += ["-c:a", "copy"]

    cmd += ["-c:v", "libx264", "-preset", "fast", "-crf", "18", str(output_path)]

    _run_ffmpeg_progress(cmd, seg_duration, on_progress, *progress_range)


def apply_aspect_ratio(input_path: Path, output_path: Path, ratio_key: str, pos: float = 0.5) -> None:
    """Recadre (crop, sans déformation) au format d'affichage choisi, sans autre transformation."""
    cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-vf", _crop_filter(ratio_key, pos),
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-c:a", "copy",
        str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())


def _extract_passthrough(
    input_path: Path, output_path: Path, start: str, end: str,
    on_progress: ProgressCallback | None, progress_range: tuple[float, float],
) -> None:
    """Extrait un intervalle de la vidéo source tel quel, sans aucune transformation —
    utilisé pour les portions non sélectionnées par l'utilisateur en mode "morceaux, garder
    l'ensemble" (le reste de la vidéo doit rester inchangé, à sa place)."""
    trim_expr = f"start={time_to_seconds(start)}:end={time_to_seconds(end)}"
    cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-vf", f"trim={trim_expr},setpts=PTS-STARTPTS",
        "-filter:a", f"atrim={trim_expr},asetpts=PTS-STARTPTS",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-c:a", "aac",
        str(output_path),
    ]
    seg_duration = time_to_seconds(end) - time_to_seconds(start)
    _run_ffmpeg_progress(cmd, seg_duration, on_progress, *progress_range)


def orient_segments(
    input_path: Path, segments: list[dict], output_path: Path,
    on_progress: ProgressCallback | None = None, keep_full: bool = False,
) -> None:
    """segments: [{"start", "end", "actions": list[str], "aspect_ratio": str|None,
    "aspect_position": float, "crop_rect": dict|None, "zoom_rect": dict|None,
    "zoom_animated": bool}, ...] — orientation, format d'affichage ET zoom propres à chaque morceau.

    Par défaut (`keep_full=False`), la sortie ne contient que les morceaux sélectionnés,
    mis bout à bout (le reste de la vidéo est coupé). Avec `keep_full=True`, la sortie garde
    toute la durée d'origine : les portions non sélectionnées sont réinsérées telles quelles
    entre les morceaux transformés, à leur place.

    Des morceaux avec des rotations ou formats différents produisent des dimensions
    différentes : on harmonise sur la plus grande taille (scale + pad) avant de
    concaténer via un filtre plutôt qu'un simple stream copy.
    """
    if not segments:
        raise ValueError("Aucun segment fourni.")

    ordered = sorted(segments, key=lambda s: time_to_seconds(s["start"]))

    parts = ordered
    if keep_full:
        full_duration = probe_duration(input_path)
        if full_duration is None:
            raise ValueError("Impossible de déterminer la durée de la vidéo source.")

        parts = []
        cursor_t = 0.0
        for seg in ordered:
            s, e = time_to_seconds(seg["start"]), time_to_seconds(seg["end"])
            if s > cursor_t + 0.05:
                parts.append({"start": str(cursor_t), "end": str(s), "passthrough": True})
            parts.append(seg)
            cursor_t = e
        if cursor_t < full_duration - 0.05:
            parts.append({"start": str(cursor_t), "end": str(full_duration), "passthrough": True})

    durations = [max(time_to_seconds(p["end"]) - time_to_seconds(p["start"]), 0.01) for p in parts]
    total = sum(durations)
    # La passe finale d'harmonisation + concaténation prend un temps non négligeable
    # (contrairement au simple stream copy de trim_media) : on lui réserve une vraie part.
    trim_budget = 0.85 if on_progress else 1.0

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        part_paths = []
        cursor = 0.0

        for i, (part, dur) in enumerate(zip(parts, durations)):
            part_path = tmp_dir / f"part_{i}{input_path.suffix}"
            span = (dur / total) * trim_budget
            if part.get("passthrough"):
                _extract_passthrough(
                    input_path, part_path, part["start"], part["end"],
                    on_progress, (cursor, cursor + span),
                )
            else:
                change_orientation(
                    input_path, part_path,
                    part.get("actions") or [],
                    part.get("start"), part.get("end"),
                    part.get("aspect_ratio"), part.get("aspect_position", 0.5),
                    part.get("crop_rect"), part.get("zoom_rect"), part.get("zoom_animated", False),
                    on_progress=on_progress, progress_range=(cursor, cursor + span),
                )
            cursor += span
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
        _run_ffmpeg_progress(cmd, total, on_progress, cursor, 1.0)


def main() -> None:
    parser = argparse.ArgumentParser(description="Modifier l'orientation d'une vidéo")
    parser.add_argument("video", type=Path, help="Chemin du fichier vidéo source")
    parser.add_argument(
        "-a", "--action", choices=ACTIONS, action="append", default=None,
        help="Action d'orientation globale (répétable pour combiner, ex: -a rotate_90_cw -a flip_horizontal)",
    )
    parser.add_argument("--aspect", choices=ASPECT_RATIOS, default=None, help="Format d'affichage global")
    parser.add_argument("--aspect-pos", type=float, default=0.5, help="Position du recadrage (0..1, défaut 0.5)")
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

    if not args.action and not args.aspect:
        sys.exit("Erreur : préciser au moins un --action, un --aspect ou un --segment.")

    output_path = args.output or args.video.with_stem(args.video.stem + "_orientation")

    try:
        change_orientation(args.video, output_path, args.action or [], aspect_ratio=args.aspect, aspect_position=args.aspect_pos)
    except RuntimeError as e:
        sys.exit(f"Erreur ffmpeg : {e}")

    print(f"Orientation modifiée : {output_path}")


if __name__ == "__main__":
    main()
