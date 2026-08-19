#!/usr/bin/env python3
"""Stone Studio — serveur web (FastAPI)."""

import json
import shutil
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.requests import Request

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(ROOT / "tools" / "extract_audio"))
sys.path.insert(0, str(ROOT / "tools" / "trim_media"))
sys.path.insert(0, str(ROOT / "tools" / "speed_media"))
sys.path.insert(0, str(ROOT / "tools" / "orientation"))
from extract_audio import FORMATS, extract_audio  # noqa: E402
from media_utils import generate_thumbnail, probe_media  # noqa: E402
from orientation import (  # noqa: E402
    ACTIONS as ORIENTATION_ACTIONS,
    ASPECT_RATIOS,
    change_orientation,
    orient_segments,
)
from speed_media import change_speed, speed_segments  # noqa: E402
from trim_media import combine_segments, is_valid_time  # noqa: E402

UPLOADS_DIR = ROOT / "uploads"
OUTPUT_DIR = ROOT / "output"
THUMBS_DIR = ROOT / "thumbnails"
PROJECTS_FILE = ROOT / "projects.json"
UPLOADS_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)
THUMBS_DIR.mkdir(exist_ok=True)

DIRS = {"uploads": UPLOADS_DIR, "output": OUTPUT_DIR}

app = FastAPI(title="Stone Studio")
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")
templates = Jinja2Templates(directory=Path(__file__).parent / "templates")

TOOL_LABELS = {
    "upload": "Fichier importé",
    "extract_audio": "Extraction audio",
    "trim_media": "Trim media",
    "speed_media": "Speed",
    "orientation": "Orientation",
}


def load_projects() -> list[dict]:
    if not PROJECTS_FILE.exists():
        return []
    return json.loads(PROJECTS_FILE.read_text())


def save_project(
    tool: str, input_name: str | None, output_dir: str, output_file: str, output_name: str
) -> None:
    label = TOOL_LABELS[tool]
    file_path = DIRS[output_dir] / output_file
    output_size = file_path.stat().st_size

    media_info = probe_media(file_path)
    project_id = Path(output_file).stem

    has_thumbnail = False
    if media_info["media_type"] == "video":
        thumb_path = THUMBS_DIR / f"{project_id}.jpg"
        has_thumbnail = generate_thumbnail(file_path, thumb_path, media_info["duration"])

    projects = load_projects()
    projects.insert(0, {
        "id": project_id,
        "tool": tool,
        "tool_label": label,
        "is_source": tool == "upload",
        "input_name": input_name,
        "output_dir": output_dir,
        "output_file": output_file,
        "output_name": output_name,
        "output_size": output_size,
        "media_type": media_info["media_type"],
        "duration": media_info["duration"],
        "width": media_info["width"],
        "height": media_info["height"],
        "has_thumbnail": has_thumbnail,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    PROJECTS_FILE.write_text(json.dumps(projects, indent=2))


@app.get("/")
def index(request: Request):
    return templates.TemplateResponse(request, "index.html", {"active_tool": "extract_audio"})


@app.get("/trim")
def trim_page(request: Request):
    return templates.TemplateResponse(request, "trim.html", {"active_tool": "trim_media"})


@app.get("/speed")
def speed_page(request: Request):
    return templates.TemplateResponse(request, "speed.html", {"active_tool": "speed_media"})


@app.get("/orientation")
def orientation_page(request: Request):
    return templates.TemplateResponse(request, "orientation.html", {"active_tool": "orientation"})


@app.get("/projects")
def projects_page(request: Request):
    return templates.TemplateResponse(
        request, "projects.html", {"active_tool": "projects", "projects": load_projects()}
    )


@app.get("/api/projects")
def api_projects():
    return load_projects()


@app.get("/api/projects/{project_id}/download")
def download_project(project_id: str):
    record = next((p for p in load_projects() if p["id"] == project_id), None)
    if not record:
        raise HTTPException(404, "Projet introuvable")

    path = DIRS[record.get("output_dir", "output")] / record["output_file"]
    if not path.exists():
        raise HTTPException(404, "Fichier introuvable")

    return FileResponse(path, filename=record["output_name"], media_type="application/octet-stream")


@app.get("/api/projects/{project_id}/thumbnail")
def project_thumbnail(project_id: str):
    path = THUMBS_DIR / f"{project_id}.jpg"
    if not path.exists():
        raise HTTPException(404, "Pas de miniature")
    return FileResponse(path, media_type="image/jpeg")


@app.post("/api/extract-audio")
async def api_extract_audio(
    video: UploadFile = File(...),
    format: str = Form("mp3"),
    bitrate: str | None = Form(None),
    channels: str | None = Form(None),
    sample_rate: int | None = Form(None),
):
    if format not in FORMATS:
        raise HTTPException(400, f"Format non supporté : {format}")

    job_id = uuid.uuid4().hex
    video_file = f"{job_id}_{video.filename}"
    video_path = UPLOADS_DIR / video_file
    output_file = f"{job_id}.{format}"
    output_path = OUTPUT_DIR / output_file

    with video_path.open("wb") as f:
        shutil.copyfileobj(video.file, f)
    save_project("upload", None, "uploads", video_file, video.filename)

    try:
        extract_audio(video_path, output_path, format, bitrate, channels, sample_rate)
    except RuntimeError as e:
        raise HTTPException(500, f"Erreur ffmpeg : {e}") from e

    stem = Path(video.filename).stem
    output_name = f"{stem}.{format}"
    save_project("extract_audio", video.filename, "output", output_file, output_name)

    return FileResponse(output_path, filename=output_name, media_type="application/octet-stream")


@app.post("/api/trim-media")
async def api_trim_media(
    media: UploadFile = File(...),
    segments: str = Form(...),  # JSON: [{"start": "00:00:01", "end": "00:00:04"}, ...]
):
    try:
        seg_list = json.loads(segments)
    except json.JSONDecodeError as e:
        raise HTTPException(400, "Le champ 'segments' doit être un JSON valide.") from e

    if not isinstance(seg_list, list) or not seg_list:
        raise HTTPException(400, "Au moins un segment est requis.")

    pairs = []
    for seg in seg_list:
        start, end = seg.get("start"), seg.get("end")
        if not is_valid_time(start or "") or not is_valid_time(end or ""):
            raise HTTPException(400, "Format de temps invalide dans un des segments. Utiliser HH:MM:SS.")
        pairs.append((start, end))

    job_id = uuid.uuid4().hex
    suffix = Path(media.filename).suffix
    media_file = f"{job_id}_{media.filename}"
    media_path = UPLOADS_DIR / media_file
    output_file = f"{job_id}{suffix}"
    output_path = OUTPUT_DIR / output_file

    with media_path.open("wb") as f:
        shutil.copyfileobj(media.file, f)
    save_project("upload", None, "uploads", media_file, media.filename)

    try:
        combine_segments(media_path, pairs, output_path)
    except RuntimeError as e:
        raise HTTPException(500, f"Erreur ffmpeg : {e}") from e

    stem = Path(media.filename).stem
    suffix_label = "trim" if len(pairs) == 1 else "combined"
    output_name = f"{stem}_{suffix_label}{suffix}"
    save_project("trim_media", media.filename, "output", output_file, output_name)

    return FileResponse(output_path, filename=output_name, media_type="application/octet-stream")


@app.post("/api/speed-media")
async def api_speed_media(
    media: UploadFile = File(...),
    mode: str = Form(...),  # "global" | "segments"
    factor: float | None = Form(None),
    segments: str | None = Form(None),  # JSON: [{"start","end","factor"}, ...]
):
    if mode not in ("global", "segments"):
        raise HTTPException(400, "Mode invalide (global ou segments).")

    job_id = uuid.uuid4().hex
    suffix = Path(media.filename).suffix
    media_file = f"{job_id}_{media.filename}"
    media_path = UPLOADS_DIR / media_file
    output_file = f"{job_id}{suffix}"
    output_path = OUTPUT_DIR / output_file

    with media_path.open("wb") as f:
        shutil.copyfileobj(media.file, f)
    save_project("upload", None, "uploads", media_file, media.filename)

    try:
        if mode == "global":
            if not factor or factor <= 0:
                raise HTTPException(400, "Facteur de vitesse invalide.")
            change_speed(media_path, output_path, factor)
        else:
            try:
                seg_list = json.loads(segments or "[]")
            except json.JSONDecodeError as e:
                raise HTTPException(400, "Le champ 'segments' doit être un JSON valide.") from e

            if not isinstance(seg_list, list) or not seg_list:
                raise HTTPException(400, "Au moins un segment est requis.")

            pairs = []
            for seg in seg_list:
                start, end, seg_factor = seg.get("start"), seg.get("end"), seg.get("factor")
                if not is_valid_time(start or "") or not is_valid_time(end or ""):
                    raise HTTPException(400, "Format de temps invalide dans un des segments. Utiliser HH:MM:SS.")
                if not seg_factor or seg_factor <= 0:
                    raise HTTPException(400, "Facteur de vitesse invalide dans un des segments.")
                pairs.append({"start": start, "end": end, "factor": float(seg_factor)})

            speed_segments(media_path, pairs, output_path)
    except RuntimeError as e:
        raise HTTPException(500, f"Erreur ffmpeg : {e}") from e

    stem = Path(media.filename).stem
    output_name = f"{stem}_speed{suffix}"
    save_project("speed_media", media.filename, "output", output_file, output_name)

    return FileResponse(output_path, filename=output_name, media_type="application/octet-stream")


@app.post("/api/orientation")
async def api_orientation(
    video: UploadFile = File(...),
    mode: str = Form(...),  # "global" | "segments"
    actions: str | None = Form(None),  # JSON: ["rotate_90_cw", "flip_horizontal"] (mode=global)
    segments: str | None = Form(None),  # JSON: [{"start","end","actions":[...],"aspect_ratio","aspect_position"}, ...]
    aspect_ratio: str | None = Form(None),  # ex: "portrait_9_16" (mode=global uniquement)
    aspect_position: float = Form(0.5),  # 0..1 — position du recadrage le long de l'axe rogné
):
    if mode not in ("global", "segments"):
        raise HTTPException(400, "Mode invalide (global ou segments).")
    if aspect_ratio and aspect_ratio not in ASPECT_RATIOS:
        raise HTTPException(400, f"Format d'affichage non supporté : {aspect_ratio}")

    job_id = uuid.uuid4().hex
    suffix = Path(video.filename).suffix
    video_file = f"{job_id}_{video.filename}"
    video_path = UPLOADS_DIR / video_file
    output_file = f"{job_id}{suffix}"
    output_path = OUTPUT_DIR / output_file

    with video_path.open("wb") as f:
        shutil.copyfileobj(video.file, f)
    save_project("upload", None, "uploads", video_file, video.filename)

    try:
        if mode == "global":
            try:
                action_list = json.loads(actions or "[]")
            except json.JSONDecodeError as e:
                raise HTTPException(400, "Le champ 'actions' doit être un JSON valide.") from e

            if not isinstance(action_list, list):
                raise HTTPException(400, "Le champ 'actions' doit être une liste JSON.")
            for a in action_list:
                if a not in ORIENTATION_ACTIONS:
                    raise HTTPException(400, f"Action non supportée : {a}")
            if not action_list and not aspect_ratio:
                raise HTTPException(400, "Choisissez au moins une action ou un format d'affichage.")

            change_orientation(video_path, output_path, action_list, aspect_ratio=aspect_ratio, aspect_position=aspect_position)
        else:
            try:
                seg_list = json.loads(segments or "[]")
            except json.JSONDecodeError as e:
                raise HTTPException(400, "Le champ 'segments' doit être un JSON valide.") from e

            if not isinstance(seg_list, list) or not seg_list:
                raise HTTPException(400, "Au moins un segment est requis.")

            pairs = []
            for seg in seg_list:
                start, end = seg.get("start"), seg.get("end")
                seg_actions = seg.get("actions") or []
                seg_aspect = seg.get("aspect_ratio")
                seg_pos = seg.get("aspect_position", 0.5)

                if not is_valid_time(start or "") or not is_valid_time(end or ""):
                    raise HTTPException(400, "Format de temps invalide dans un des segments. Utiliser HH:MM:SS.")
                if not isinstance(seg_actions, list):
                    raise HTTPException(400, "Les actions d'un segment doivent être une liste.")
                for a in seg_actions:
                    if a not in ORIENTATION_ACTIONS:
                        raise HTTPException(400, f"Action non supportée dans un segment : {a}")
                if seg_aspect and seg_aspect not in ASPECT_RATIOS:
                    raise HTTPException(400, f"Format non supporté dans un segment : {seg_aspect}")
                if not seg_actions and not seg_aspect:
                    raise HTTPException(400, "Chaque segment doit avoir au moins une action ou un format.")

                pairs.append({
                    "start": start, "end": end, "actions": seg_actions,
                    "aspect_ratio": seg_aspect, "aspect_position": seg_pos,
                })

            orient_segments(video_path, pairs, output_path)
    except RuntimeError as e:
        raise HTTPException(500, f"Erreur ffmpeg : {e}") from e

    stem = Path(video.filename).stem
    output_name = f"{stem}_orientation{suffix}"
    save_project("orientation", video.filename, "output", output_file, output_name)

    return FileResponse(output_path, filename=output_name, media_type="application/octet-stream")
