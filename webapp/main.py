#!/usr/bin/env python3
"""Stone Studio — serveur web (FastAPI)."""

import shutil
import sys
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.requests import Request

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools" / "extract_audio"))
sys.path.insert(0, str(ROOT / "tools" / "trim_media"))
from extract_audio import FORMATS, extract_audio  # noqa: E402
from trim_media import is_valid_time, trim_media  # noqa: E402

UPLOADS_DIR = ROOT / "uploads"
OUTPUT_DIR = ROOT / "output"
UPLOADS_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Stone Studio")
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")
templates = Jinja2Templates(directory=Path(__file__).parent / "templates")


@app.get("/")
def index(request: Request):
    return templates.TemplateResponse(request, "index.html", {"active_tool": "extract_audio"})


@app.get("/trim")
def trim_page(request: Request):
    return templates.TemplateResponse(request, "trim.html", {"active_tool": "trim_media"})


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
    video_path = UPLOADS_DIR / f"{job_id}_{video.filename}"
    output_path = OUTPUT_DIR / f"{job_id}.{format}"

    try:
        with video_path.open("wb") as f:
            shutil.copyfileobj(video.file, f)

        extract_audio(video_path, output_path, format, bitrate, channels, sample_rate)
    except RuntimeError as e:
        raise HTTPException(500, f"Erreur ffmpeg : {e}") from e
    finally:
        video_path.unlink(missing_ok=True)

    stem = Path(video.filename).stem
    return FileResponse(
        output_path,
        filename=f"{stem}.{format}",
        media_type="application/octet-stream",
    )


@app.post("/api/trim-media")
async def api_trim_media(
    media: UploadFile = File(...),
    start: str = Form("00:00:00"),
    end: str | None = Form(None),
):
    if not is_valid_time(start) or (end and not is_valid_time(end)):
        raise HTTPException(400, "Format de temps invalide. Utiliser HH:MM:SS.")

    job_id = uuid.uuid4().hex
    suffix = Path(media.filename).suffix
    media_path = UPLOADS_DIR / f"{job_id}_{media.filename}"
    output_path = OUTPUT_DIR / f"{job_id}{suffix}"

    try:
        with media_path.open("wb") as f:
            shutil.copyfileobj(media.file, f)

        trim_media(media_path, output_path, start, end)
    except RuntimeError as e:
        raise HTTPException(500, f"Erreur ffmpeg : {e}") from e
    finally:
        media_path.unlink(missing_ok=True)

    stem = Path(media.filename).stem
    return FileResponse(
        output_path,
        filename=f"{stem}_trim{suffix}",
        media_type="application/octet-stream",
    )
