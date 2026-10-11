"""Point d'entrée du serveur Stone Studio pour l'application desktop.

Lance la même application FastAPI que la version web, sur 127.0.0.1 et sur le port choisi par
Electron. Empaqueté par PyInstaller pour que l'utilisateur final n'ait pas besoin de Python."""

import argparse
import os
import sys
import threading
from pathlib import Path

if not getattr(sys, "frozen", False):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import uvicorn  # noqa: E402


def _exit_when_parent_dies() -> None:
    # Electron garde notre stdin ouvert : EOF signifie qu'il a quitté ou planté, donc on ne laisse
    # pas un serveur orphelin tourner en arrière-plan.
    try:
        while sys.stdin.read(1024):
            pass
    finally:
        os._exit(0)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--watch-stdin", action="store_true")
    args = parser.parse_args()

    if args.watch_stdin:
        threading.Thread(target=_exit_when_parent_dies, daemon=True).start()

    from webapp.main import app

    uvicorn.run(app, host="127.0.0.1", port=args.port, loop="asyncio", http="h11", ws="none", log_level="warning")


if __name__ == "__main__":
    main()
