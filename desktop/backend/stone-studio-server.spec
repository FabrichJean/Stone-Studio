# PyInstaller : `pyinstaller desktop/backend/stone-studio-server.spec` depuis la racine du dépôt.
# Produit un dossier autonome (onedir) : démarrage plus rapide qu'un exécutable unique, et un
# seul processus, ce qui permet à Electron de l'arrêter proprement.
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

ROOT = Path(SPECPATH).resolve().parents[1]
TOOL_DIRS = [str(p) for p in sorted((ROOT / "tools").iterdir()) if p.is_dir()]

a = Analysis(
    [str(ROOT / "desktop" / "backend" / "server.py")],
    # main.py importe les outils et ses modules voisins par leur nom nu, via sys.path.
    pathex=[str(ROOT), str(ROOT / "webapp"), *TOOL_DIRS],
    datas=[
        (str(ROOT / "webapp" / "templates"), "webapp/templates"),
        (str(ROOT / "webapp" / "static"), "webapp/static"),
    ],
    hiddenimports=["webapp.main", *collect_submodules("uvicorn")],
    excludes=["tkinter", "pytest", "PyInstaller"],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="stone-studio-server",
    # Console conservée : sous Windows, Electron la masque, et les appels ffmpeg en héritent
    # au lieu d'ouvrir chacun une fenêtre noire.
    console=True,
)
coll = COLLECT(exe, a.binaries, a.datas, name="stone-studio-server")
