#!/usr/bin/env python3
"""Vérifie qu'un environnement peut faire tourner Stone Studio, et crée les dossiers de travail.

Utilise uniquement la bibliothèque standard, pour fonctionner avant `pip install -r requirements.txt`."""

import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MIN_PYTHON = (3, 10)

PYTHON_PACKAGES = {
    "fastapi": "fastapi",
    "uvicorn": "uvicorn[standard]",
    "multipart": "python-multipart",
    "jinja2": "jinja2",
    "numpy": "numpy",
}

FFMPEG_FILTERS = [
    "life", "mandelbrot", "cellauto", "gradients", "sierpinski",
    "anoisesrc", "showwaves", "showspectrum", "showcqt", "avectorscope",
]

FFMPEG_ENCODERS = ["libx264", "aac"]

WORK_DIRS = ["uploads", "output", "thumbnails"]


def check_python() -> list[str]:
    if sys.version_info < MIN_PYTHON:
        return [f"Python {MIN_PYTHON[0]}.{MIN_PYTHON[1]}+ requis (actuel : {sys.version.split()[0]})"]
    return []


def check_binaries() -> list[str]:
    errors = []
    for binary in ("ffmpeg", "ffprobe"):
        if not shutil.which(binary):
            errors.append(f"`{binary}` introuvable dans le PATH")
    if errors:
        return errors

    filters = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True).stdout
    for name in FFMPEG_FILTERS:
        if f" {name} " not in filters:
            errors.append(f"filtre ffmpeg manquant : {name} (build ffmpeg incomplet)")

    encoders = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
    for name in FFMPEG_ENCODERS:
        if f" {name} " not in encoders:
            errors.append(f"encodeur ffmpeg manquant : {name}")
    return errors


def check_packages() -> list[str]:
    missing = [pip_name for module, pip_name in PYTHON_PACKAGES.items() if importlib.util.find_spec(module) is None]
    if not missing:
        return []
    return [f"paquets Python manquants : {' '.join(missing)} — lancez `pip install -r requirements.txt`"]


def ensure_work_dirs() -> None:
    for name in WORK_DIRS:
        (ROOT / name).mkdir(exist_ok=True)


def main() -> int:
    ensure_work_dirs()
    checks = [
        ("Python", check_python),
        ("ffmpeg / ffprobe", check_binaries),
        ("Paquets Python", check_packages),
    ]
    failures = []
    for label, check in checks:
        errors = check()
        status = "OK" if not errors else "ECHEC"
        print(f"[{status}] {label}")
        for err in errors:
            print(f"       - {err}")
        failures.extend(errors)

    if failures:
        print(f"\n{len(failures)} problème(s) à corriger avant de lancer l'application.")
        return 1
    print("\nEnvironnement prêt. Lancez : ./run.sh")
    return 0


if __name__ == "__main__":
    sys.exit(main())
