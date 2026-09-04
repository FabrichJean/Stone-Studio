#!/usr/bin/env python3
"""Stone Studio — serveur web (FastAPI)."""

import json
import shutil
import sys
import tempfile
import threading
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
sys.path.insert(0, str(ROOT / "tools" / "screen_record"))
sys.path.insert(0, str(ROOT / "tools" / "noise_removal"))
sys.path.insert(0, str(ROOT / "tools" / "compress_media"))
from compress_media import LEVELS as COMPRESS_LEVELS, RESOLUTIONS, compress_video  # noqa: E402
from extract_audio import FORMATS, extract_audio  # noqa: E402
from media_utils import generate_filmstrip, generate_thumbnail, probe_media  # noqa: E402
from orientation import (  # noqa: E402
    ACTIONS as ORIENTATION_ACTIONS,
    ASPECT_RATIOS,
    change_orientation,
    orient_segments,
)
from screen_record import (  # noqa: E402
    FORMATS as RECORD_FORMATS,
    finalize_recording,
)
from noise_removal import LEVELS as NOISE_LEVELS, remove_noise  # noqa: E402
from speed_media import change_speed, speed_segments  # noqa: E402
from trim_media import combine_segments, is_valid_time  # noqa: E402
from studio_chain import ChainError, concat_clips, run_chain  # noqa: E402

UPLOADS_DIR = ROOT / "uploads"
OUTPUT_DIR = ROOT / "output"
THUMBS_DIR = ROOT / "thumbnails"
PROJECTS_FILE = ROOT / "projects.json"
UPLOADS_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)
THUMBS_DIR.mkdir(exist_ok=True)

DIRS = {"uploads": UPLOADS_DIR, "output": OUTPUT_DIR}

# Suivi en mémoire des tâches en cours (mono-process : suffisant pour cet usage local).
COMPRESS_JOBS: dict[str, dict] = {}
EXTRACT_JOBS: dict[str, dict] = {}
TRIM_JOBS: dict[str, dict] = {}
RECORD_JOBS: dict[str, dict] = {}
ORIENTATION_JOBS: dict[str, dict] = {}
SPEED_JOBS: dict[str, dict] = {}
STUDIO_JOBS: dict[str, dict] = {}

app = FastAPI(title="Stone Studio")


class NoCacheStaticFiles(StaticFiles):
    """Sans en-tête Cache-Control, le navigateur applique sa fraîcheur heuristique et
    peut servir un JS/CSS périmé après une modification. On force la revalidation."""

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-cache"
        return response


STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", NoCacheStaticFiles(directory=STATIC_DIR), name="static")
templates = Jinja2Templates(directory=Path(__file__).parent / "templates")


def static_url(name: str) -> str:
    """Ajoute la date de modification à l'URL : le navigateur ne peut pas resservir
    une version périmée d'un fichier modifié, même s'il l'a déjà en cache."""
    path = STATIC_DIR / name
    version = int(path.stat().st_mtime) if path.exists() else 0
    return f"/static/{name}?v={version}"


templates.env.globals["static_url"] = static_url

TOOL_LABELS = {
    "upload": "Fichier importé",
    "extract_audio": "Extraction audio",
    "trim_media": "Trim media",
    "speed_media": "Speed",
    "orientation": "Screen",
    "screen_record": "Enregistrement écran",
    "noise_removal": "Suppression bruit",
    "compress_media": "Compression vidéo",
    "studio_chain": "Studio",
}


def load_projects() -> list[dict]:
    if not PROJECTS_FILE.exists():
        return []
    return json.loads(PROJECTS_FILE.read_text())


def save_project(
    tool: str, input_name: str | None, output_dir: str, output_file: str, output_name: str
) -> dict:
    label = TOOL_LABELS[tool]
    file_path = DIRS[output_dir] / output_file
    output_size = file_path.stat().st_size

    media_info = probe_media(file_path)
    project_id = Path(output_file).stem

    has_thumbnail = False
    has_filmstrip = False
    if media_info["media_type"] == "video":
        thumb_path = THUMBS_DIR / f"{project_id}.jpg"
        has_thumbnail = generate_thumbnail(file_path, thumb_path, media_info["duration"])
        filmstrip_path = THUMBS_DIR / f"{project_id}_filmstrip.jpg"
        has_filmstrip = generate_filmstrip(file_path, filmstrip_path, media_info["duration"])

    record = {
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
        "has_filmstrip": has_filmstrip,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    projects = load_projects()
    projects.insert(0, record)
    PROJECTS_FILE.write_text(json.dumps(projects, indent=2))
    return record


@app.get("/")
def index(request: Request):
    return templates.TemplateResponse(request, "index.html", {"active_tool": "extract_audio"})


@app.get("/studio")
def studio_page(request: Request):
    return templates.TemplateResponse(request, "studio.html", {"active_tool": "studio"})


def _resolve_project_path(project_id: str) -> tuple[Path, dict]:
    record = next((p for p in load_projects() if p["id"] == project_id), None)
    if not record:
        raise HTTPException(404, "Projet introuvable")
    path = DIRS[record.get("output_dir", "output")] / record["output_file"]
    if not path.exists():
        raise HTTPException(404, "Fichier introuvable")
    return path, record


@app.post("/api/studio/upload")
async def api_studio_upload(file: UploadFile = File(...)):
    file_id = uuid.uuid4().hex
    stored_name = f"{file_id}_{file.filename}"
    path = UPLOADS_DIR / stored_name

    with path.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    record = save_project("upload", None, "uploads", stored_name, file.filename)

    return record


def _run_studio_job(job_id: str, source_path: Path, chain: list[dict], base_name: str) -> None:
    def on_progress(frac: float) -> None:
        STUDIO_JOBS[job_id]["percent"] = round(frac * 100, 1)

    with tempfile.TemporaryDirectory() as tmp:
        try:
            result_path = run_chain(source_path, chain, Path(tmp), on_progress)
        except ChainError as e:
            STUDIO_JOBS[job_id] = {"status": "error", "percent": 0, "error": str(e)}
            return

        output_file = f"{job_id}{result_path.suffix}"
        output_path = OUTPUT_DIR / output_file
        shutil.copyfile(result_path, output_path)
        output_name = f"{base_name}{result_path.suffix}"
        record = save_project("studio_chain", base_name, "output", output_file, output_name)
        STUDIO_JOBS[job_id] = {
            "status": "done", "percent": 100,
            "project_id": record["id"],
            "output_name": output_name,
            "output_size": output_path.stat().st_size,
            "duration": record["duration"],
            "media_type": record["media_type"],
            "has_filmstrip": record["has_filmstrip"],
        }


@app.post("/api/studio/render")
async def api_studio_render(project_id: str = Form(...), chain: str = Form(...)):
    try:
        parsed_chain = json.loads(chain)
    except json.JSONDecodeError:
        raise HTTPException(400, "Chaîne d'actions invalide")

    source_path, record = _resolve_project_path(project_id)
    base_name = Path(record["output_name"]).stem

    job_id = uuid.uuid4().hex
    STUDIO_JOBS[job_id] = {"status": "processing", "percent": 0}
    thread = threading.Thread(
        target=_run_studio_job, args=(job_id, source_path, parsed_chain, base_name), daemon=True,
    )
    thread.start()
    return {"job_id": job_id}


@app.get("/api/studio/render/{job_id}/progress")
def studio_render_progress(job_id: str):
    job = STUDIO_JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Job introuvable")
    return job


def _run_timeline_export_job(job_id: str, paths: list[Path], base_name: str) -> None:
    def on_progress(frac: float) -> None:
        STUDIO_JOBS[job_id]["percent"] = round(frac * 100, 1)

    with tempfile.TemporaryDirectory() as tmp:
        try:
            result_path = concat_clips(paths, Path(tmp), on_progress)
        except ChainError as e:
            STUDIO_JOBS[job_id] = {"status": "error", "percent": 0, "error": str(e)}
            return

        output_file = f"{job_id}{result_path.suffix}"
        output_path = OUTPUT_DIR / output_file
        shutil.copyfile(result_path, output_path)
        output_name = f"{base_name}{result_path.suffix}"
        record = save_project("studio_chain", base_name, "output", output_file, output_name)
        STUDIO_JOBS[job_id] = {
            "status": "done", "percent": 100,
            "project_id": record["id"],
            "output_name": output_name,
            "output_size": output_path.stat().st_size,
            "duration": record["duration"],
            "media_type": record["media_type"],
            "has_filmstrip": record["has_filmstrip"],
        }


@app.post("/api/studio/export-timeline")
async def api_studio_export_timeline(clip_ids: str = Form(...)):
    try:
        ids = json.loads(clip_ids)
    except json.JSONDecodeError:
        raise HTTPException(400, "Timeline invalide")
    if not ids:
        raise HTTPException(400, "La timeline est vide")

    paths = []
    base_name = None
    for cid in ids:
        path, record = _resolve_project_path(cid)
        paths.append(path)
        if base_name is None:
            base_name = Path(record["output_name"]).stem

    job_id = uuid.uuid4().hex
    STUDIO_JOBS[job_id] = {"status": "processing", "percent": 0}
    thread = threading.Thread(
        target=_run_timeline_export_job, args=(job_id, paths, base_name), daemon=True,
    )
    thread.start()
    return {"job_id": job_id}


@app.get("/trim")
def trim_page(request: Request):
    return templates.TemplateResponse(request, "trim.html", {"active_tool": "trim_media"})


@app.get("/speed")
def speed_page(request: Request):
    return templates.TemplateResponse(request, "speed.html", {"active_tool": "speed_media"})


@app.get("/orientation")
def orientation_page(request: Request):
    return templates.TemplateResponse(request, "orientation.html", {"active_tool": "orientation"})


@app.get("/noise-removal")
def noise_removal_page(request: Request):
    return templates.TemplateResponse(request, "noise_removal.html", {"active_tool": "noise_removal"})


@app.get("/compress")
def compress_page(request: Request):
    return templates.TemplateResponse(request, "compress_media.html", {"active_tool": "compress_media"})


@app.get("/record")
def record_page(request: Request):
    return templates.TemplateResponse(request, "record.html", {"active_tool": "screen_record"})


@app.get("/projects")
def projects_page(request: Request):
    return templates.TemplateResponse(
        request, "projects.html", {"active_tool": "projects", "projects": load_projects()}
    )


@app.get("/api/projects")
def api_projects():
    return load_projects()


@app.get("/api/projects/{project_id}")
def get_project(project_id: str):
    record = next((p for p in load_projects() if p["id"] == project_id), None)
    if not record:
        raise HTTPException(404, "Projet introuvable")
    return record


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


@app.get("/api/projects/{project_id}/filmstrip")
def project_filmstrip(project_id: str):
    path = THUMBS_DIR / f"{project_id}_filmstrip.jpg"
    if not path.exists():
        raise HTTPException(404, "Pas de bande de vignettes")
    return FileResponse(path, media_type="image/jpeg")


def _run_extract_job(
    job_id: str, video_path: Path, output_path: Path, filename: str,
    fmt: str, bitrate: str | None, channels: str | None, sample_rate: int | None,
) -> None:
    def on_progress(frac: float) -> None:
        EXTRACT_JOBS[job_id]["percent"] = round(frac * 100, 1)

    try:
        extract_audio(video_path, output_path, fmt, bitrate, channels, sample_rate, on_progress)
    except RuntimeError as e:
        EXTRACT_JOBS[job_id] = {"status": "error", "percent": 0, "error": str(e)}
        return

    stem = Path(filename).stem
    output_name = f"{stem}.{fmt}"
    save_project("extract_audio", filename, "output", output_path.name, output_name)
    EXTRACT_JOBS[job_id] = {
        "status": "done", "percent": 100,
        "project_id": Path(output_path.name).stem,
        "output_name": output_name,
        "output_size": output_path.stat().st_size,
    }


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

    EXTRACT_JOBS[job_id] = {"status": "processing", "percent": 0}
    thread = threading.Thread(
        target=_run_extract_job,
        args=(job_id, video_path, output_path, video.filename, format, bitrate, channels, sample_rate),
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id}


@app.get("/api/extract-audio/{job_id}/progress")
def extract_progress(job_id: str):
    job = EXTRACT_JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Tâche introuvable")
    return job


def _run_trim_job(
    job_id: str, media_path: Path, output_path: Path, filename: str, pairs: list[tuple[str, str]]
) -> None:
    def on_progress(frac: float) -> None:
        TRIM_JOBS[job_id]["percent"] = round(frac * 100, 1)

    try:
        combine_segments(media_path, pairs, output_path, on_progress)
    except RuntimeError as e:
        TRIM_JOBS[job_id] = {"status": "error", "percent": 0, "error": str(e)}
        return

    stem = Path(filename).stem
    suffix_label = "trim" if len(pairs) == 1 else "combined"
    output_name = f"{stem}_{suffix_label}{output_path.suffix}"
    save_project("trim_media", filename, "output", output_path.name, output_name)
    TRIM_JOBS[job_id] = {
        "status": "done", "percent": 100,
        "project_id": Path(output_path.name).stem,
        "output_name": output_name,
        "output_size": output_path.stat().st_size,
    }


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

    TRIM_JOBS[job_id] = {"status": "processing", "percent": 0}
    thread = threading.Thread(
        target=_run_trim_job,
        args=(job_id, media_path, output_path, media.filename, pairs),
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id}


@app.get("/api/trim-media/{job_id}/progress")
def trim_progress(job_id: str):
    job = TRIM_JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Tâche introuvable")
    return job


def _run_speed_job(
    job_id: str, media_path: Path, output_path: Path, filename: str,
    mode: str, factor: float | None, pairs: list[dict] | None,
) -> None:
    def on_progress(frac: float) -> None:
        SPEED_JOBS[job_id]["percent"] = round(frac * 100, 1)

    try:
        if mode == "global":
            change_speed(media_path, output_path, factor, on_progress=on_progress)
        else:
            speed_segments(media_path, pairs, output_path, on_progress)
    except RuntimeError as e:
        SPEED_JOBS[job_id] = {"status": "error", "percent": 0, "error": str(e)}
        return

    stem = Path(filename).stem
    output_name = f"{stem}_speed{output_path.suffix}"
    save_project("speed_media", filename, "output", output_path.name, output_name)
    SPEED_JOBS[job_id] = {
        "status": "done", "percent": 100,
        "project_id": Path(output_path.name).stem,
        "output_name": output_name,
        "output_size": output_path.stat().st_size,
    }


@app.post("/api/speed-media")
async def api_speed_media(
    media: UploadFile = File(...),
    mode: str = Form(...),  # "global" | "segments"
    factor: float | None = Form(None),
    segments: str | None = Form(None),  # JSON: [{"start","end","factor"}, ...]
):
    if mode not in ("global", "segments"):
        raise HTTPException(400, "Mode invalide (global ou segments).")

    pairs = None
    if mode == "global":
        if not factor or factor <= 0:
            raise HTTPException(400, "Facteur de vitesse invalide.")
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

    job_id = uuid.uuid4().hex
    suffix = Path(media.filename).suffix
    media_file = f"{job_id}_{media.filename}"
    media_path = UPLOADS_DIR / media_file
    output_file = f"{job_id}{suffix}"
    output_path = OUTPUT_DIR / output_file

    with media_path.open("wb") as f:
        shutil.copyfileobj(media.file, f)
    save_project("upload", None, "uploads", media_file, media.filename)

    SPEED_JOBS[job_id] = {"status": "processing", "percent": 0}
    thread = threading.Thread(
        target=_run_speed_job,
        args=(job_id, media_path, output_path, media.filename, mode, factor, pairs),
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id}


@app.get("/api/speed-media/{job_id}/progress")
def speed_progress(job_id: str):
    job = SPEED_JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Tâche introuvable")
    return job


def _validate_crop_rect(rect) -> None:
    if not isinstance(rect, dict) or set(rect) != {"x", "y", "w", "h"}:
        raise HTTPException(400, "'crop_rect' doit contenir x, y, w, h.")
    for key in ("x", "y", "w", "h"):
        if not isinstance(rect[key], (int, float)) or not 0 <= rect[key] <= 1:
            raise HTTPException(400, "Les valeurs de 'crop_rect' doivent être entre 0 et 1.")
    if rect["w"] <= 0 or rect["h"] <= 0:
        raise HTTPException(400, "Le cadre personnalisé doit avoir une largeur et une hauteur positives.")
    if rect["x"] + rect["w"] > 1.001 or rect["y"] + rect["h"] > 1.001:
        raise HTTPException(400, "Le cadre personnalisé dépasse les limites de l'image.")


def _run_orientation_job(
    job_id: str, video_path: Path, output_path: Path, filename: str, mode: str,
    action_list: list[str] | None, aspect_ratio: str | None, aspect_position: float,
    parsed_crop_rect: dict | None, pairs: list[dict] | None,
) -> None:
    def on_progress(frac: float) -> None:
        ORIENTATION_JOBS[job_id]["percent"] = round(frac * 100, 1)

    try:
        if mode == "global":
            change_orientation(
                video_path, output_path, action_list or [],
                aspect_ratio=aspect_ratio, aspect_position=aspect_position, crop_rect=parsed_crop_rect,
                on_progress=on_progress,
            )
        else:
            orient_segments(video_path, pairs, output_path, on_progress)
    except RuntimeError as e:
        ORIENTATION_JOBS[job_id] = {"status": "error", "percent": 0, "error": str(e)}
        return

    stem = Path(filename).stem
    output_name = f"{stem}_orientation{output_path.suffix}"
    save_project("orientation", filename, "output", output_path.name, output_name)
    ORIENTATION_JOBS[job_id] = {
        "status": "done", "percent": 100,
        "project_id": Path(output_path.name).stem,
        "output_name": output_name,
        "output_size": output_path.stat().st_size,
    }


@app.post("/api/orientation")
async def api_orientation(
    video: UploadFile = File(...),
    mode: str = Form(...),  # "global" | "segments"
    actions: str | None = Form(None),  # JSON: ["rotate_90_cw", "flip_horizontal"] (mode=global)
    segments: str | None = Form(None),  # JSON: [{"start","end","actions":[...],"aspect_ratio","aspect_position"}, ...]
    aspect_ratio: str | None = Form(None),  # ex: "portrait_9_16" (mode=global uniquement)
    aspect_position: float = Form(0.5),  # 0..1 — position du recadrage le long de l'axe rogné
    crop_rect: str | None = Form(None),  # JSON {"x","y","w","h"} fractions 0..1 (mode=global, format personnalisé)
):
    if mode not in ("global", "segments"):
        raise HTTPException(400, "Mode invalide (global ou segments).")
    if aspect_ratio and aspect_ratio not in ASPECT_RATIOS:
        raise HTTPException(400, f"Format d'affichage non supporté : {aspect_ratio}")

    parsed_crop_rect = None
    if crop_rect:
        try:
            parsed_crop_rect = json.loads(crop_rect)
        except json.JSONDecodeError as e:
            raise HTTPException(400, "Le champ 'crop_rect' doit être un JSON valide.") from e
        _validate_crop_rect(parsed_crop_rect)

    action_list = None
    pairs = None

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
        if not action_list and not aspect_ratio and not parsed_crop_rect:
            raise HTTPException(400, "Choisissez au moins une action ou un format d'affichage.")
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
            seg_crop_rect = seg.get("crop_rect")

            if not is_valid_time(start or "") or not is_valid_time(end or ""):
                raise HTTPException(400, "Format de temps invalide dans un des segments. Utiliser HH:MM:SS.")
            if not isinstance(seg_actions, list):
                raise HTTPException(400, "Les actions d'un segment doivent être une liste.")
            for a in seg_actions:
                if a not in ORIENTATION_ACTIONS:
                    raise HTTPException(400, f"Action non supportée dans un segment : {a}")
            if seg_aspect and seg_aspect not in ASPECT_RATIOS:
                raise HTTPException(400, f"Format non supporté dans un segment : {seg_aspect}")
            if seg_crop_rect:
                _validate_crop_rect(seg_crop_rect)
            if not seg_actions and not seg_aspect and not seg_crop_rect:
                raise HTTPException(400, "Chaque segment doit avoir au moins une action ou un format.")

            pairs.append({
                "start": start, "end": end, "actions": seg_actions,
                "aspect_ratio": seg_aspect, "aspect_position": seg_pos,
                "crop_rect": seg_crop_rect,
            })

    job_id = uuid.uuid4().hex
    suffix = Path(video.filename).suffix
    video_file = f"{job_id}_{video.filename}"
    video_path = UPLOADS_DIR / video_file
    output_file = f"{job_id}{suffix}"
    output_path = OUTPUT_DIR / output_file

    with video_path.open("wb") as f:
        shutil.copyfileobj(video.file, f)
    save_project("upload", None, "uploads", video_file, video.filename)

    ORIENTATION_JOBS[job_id] = {"status": "processing", "percent": 0}
    thread = threading.Thread(
        target=_run_orientation_job,
        args=(
            job_id, video_path, output_path, video.filename, mode,
            action_list, aspect_ratio, aspect_position, parsed_crop_rect, pairs,
        ),
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id}


@app.get("/api/orientation/{job_id}/progress")
def orientation_progress(job_id: str):
    job = ORIENTATION_JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Tâche introuvable")
    return job


def _run_record_job(
    job_id: str, raw_path: Path, output_path: Path, format: str, name: str | None, duration: float | None
) -> None:
    def on_progress(frac: float) -> None:
        RECORD_JOBS[job_id]["percent"] = round(frac * 100, 1)

    try:
        finalize_recording(raw_path, output_path, format, on_progress, known_duration=duration)
    except RuntimeError as e:
        RECORD_JOBS[job_id] = {"status": "error", "percent": 0, "error": str(e)}
        return

    stem = Path(name).stem if name else f"enregistrement_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    output_name = f"{stem}{RECORD_FORMATS[format]['suffix']}"
    save_project("screen_record", None, "output", output_path.name, output_name)
    RECORD_JOBS[job_id] = {
        "status": "done", "percent": 100,
        "project_id": Path(output_path.name).stem,
        "output_name": output_name,
        "output_size": output_path.stat().st_size,
    }


@app.post("/api/screen-record")
async def api_screen_record(
    recording: UploadFile = File(...),
    format: str = Form("mp4"),
    name: str | None = Form(None),
    duration: float | None = Form(None),
):
    if format not in RECORD_FORMATS:
        raise HTTPException(400, f"Format non supporté : {format}")

    job_id = uuid.uuid4().hex
    raw_suffix = Path(recording.filename or "capture.webm").suffix or ".webm"
    raw_file = f"{job_id}_capture{raw_suffix}"
    raw_path = UPLOADS_DIR / raw_file
    output_file = f"{job_id}{RECORD_FORMATS[format]['suffix']}"
    output_path = OUTPUT_DIR / output_file

    with raw_path.open("wb") as f:
        shutil.copyfileobj(recording.file, f)

    if raw_path.stat().st_size == 0:
        raw_path.unlink()
        raise HTTPException(400, "L'enregistrement reçu est vide.")

    RECORD_JOBS[job_id] = {"status": "processing", "percent": 0}
    thread = threading.Thread(
        target=_run_record_job,
        args=(job_id, raw_path, output_path, format, name, duration),
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id}


@app.get("/api/screen-record/{job_id}/progress")
def record_progress(job_id: str):
    job = RECORD_JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Tâche introuvable")
    return job


@app.post("/api/noise-removal")
async def api_noise_removal(
    media: UploadFile = File(...),
    level: str = Form("medium"),
    reduce_hum: bool = Form(False),
):
    if level not in NOISE_LEVELS:
        raise HTTPException(400, f"Niveau non supporté : {level}")

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
        remove_noise(media_path, output_path, level, reduce_hum)
    except RuntimeError as e:
        raise HTTPException(500, f"Erreur ffmpeg : {e}") from e

    stem = Path(media.filename).stem
    output_name = f"{stem}_denoised{suffix}"
    save_project("noise_removal", media.filename, "output", output_file, output_name)

    return FileResponse(
        output_path, filename=output_name, media_type="application/octet-stream",
        headers={"X-Project-Id": Path(output_file).stem},
    )


def _run_compress_job(job_id: str, video_path: Path, output_path: Path, filename: str, level: str,
                       resolution: str, max_size_mb: float | None) -> None:
    def on_progress(frac: float) -> None:
        COMPRESS_JOBS[job_id]["percent"] = round(frac * 100, 1)

    try:
        compress_video(video_path, output_path, level, resolution, max_size_mb, on_progress)
    except (RuntimeError, ValueError) as e:
        COMPRESS_JOBS[job_id] = {"status": "error", "percent": 0, "error": str(e)}
        return

    stem = Path(filename).stem
    output_name = f"{stem}_compressed.mp4"
    save_project("compress_media", filename, "output", output_path.name, output_name)
    COMPRESS_JOBS[job_id] = {
        "status": "done", "percent": 100,
        "project_id": Path(output_path.name).stem,
        "output_name": output_name,
        "output_size": output_path.stat().st_size,
    }


@app.post("/api/compress-media")
async def api_compress_media(
    video: UploadFile = File(...),
    level: str = Form("medium"),
    resolution: str = Form("original"),
    max_size_mb: float | None = Form(None),
):
    if level not in COMPRESS_LEVELS:
        raise HTTPException(400, f"Niveau non supporté : {level}")
    if resolution not in RESOLUTIONS:
        raise HTTPException(400, f"Résolution non supportée : {resolution}")
    if max_size_mb is not None and max_size_mb <= 0:
        raise HTTPException(400, "La taille maximale doit être positive.")

    job_id = uuid.uuid4().hex
    video_file = f"{job_id}_{video.filename}"
    video_path = UPLOADS_DIR / video_file
    output_file = f"{job_id}.mp4"
    output_path = OUTPUT_DIR / output_file

    with video_path.open("wb") as f:
        shutil.copyfileobj(video.file, f)
    save_project("upload", None, "uploads", video_file, video.filename)

    COMPRESS_JOBS[job_id] = {"status": "processing", "percent": 0}
    thread = threading.Thread(
        target=_run_compress_job,
        args=(job_id, video_path, output_path, video.filename, level, resolution, max_size_mb),
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id}


@app.get("/api/compress-media/{job_id}/progress")
def compress_progress(job_id: str):
    job = COMPRESS_JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Tâche introuvable")
    return job
