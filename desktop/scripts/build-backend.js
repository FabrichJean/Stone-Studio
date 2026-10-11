// Gèle le serveur Python (FastAPI + outils) avec PyInstaller dans build/backend/stone-studio-server.
// Utilise le venv du dépôt s'il existe, sinon le python du PATH (cas de la CI).
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const desktopDir = path.resolve(__dirname, "..");
const venvPython = process.platform === "win32"
  ? path.join(repoRoot, ".venv", "Scripts", "python.exe")
  : path.join(repoRoot, ".venv", "bin", "python");
const python = fs.existsSync(venvPython) ? venvPython : (process.platform === "win32" ? "python" : "python3");

const result = spawnSync(python, [
  "-m", "PyInstaller",
  path.join(desktopDir, "backend", "stone-studio-server.spec"),
  "--noconfirm",
  "--distpath", path.join(desktopDir, "build", "backend"),
  "--workpath", path.join(desktopDir, "build", "pyinstaller"),
], { cwd: repoRoot, stdio: "inherit" });

process.exit(result.status ?? 1);
