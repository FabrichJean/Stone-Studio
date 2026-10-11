// Stone Studio desktop : lance le serveur FastAPI (le même que la version web) en local, avec
// ffmpeg embarqué, puis l'affiche dans une fenêtre Chromium.
const { app, BrowserWindow, desktopCapturer, dialog, session, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

const SERVER_START_TIMEOUT_MS = 60_000;
const ICON_PATH = path.join(__dirname, "resources", "icon.png");
const exe = process.platform === "win32" ? ".exe" : "";

let backend = null;
let backendLogPath = null;
let mainWindow = null;
let baseUrl = null;
let quitting = false;

function resolvePaths() {
  if (app.isPackaged) {
    return {
      command: path.join(process.resourcesPath, "backend", "stone-studio-server", "stone-studio-server" + exe),
      args: [],
      ffmpegDir: path.join(process.resourcesPath, "ffmpeg"),
    };
  }
  const repoRoot = path.resolve(__dirname, "..");
  const venvPython = process.platform === "win32"
    ? path.join(repoRoot, ".venv", "Scripts", "python.exe")
    : path.join(repoRoot, ".venv", "bin", "python");
  return {
    command: venvPython,
    args: [path.join(__dirname, "backend", "server.py")],
    ffmpegDir: path.join(__dirname, "vendor", "ffmpeg"),
  };
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function startBackend(port) {
  const { command, args, ffmpegDir } = resolvePaths();
  if (!fs.existsSync(command)) {
    throw new Error(`Serveur introuvable : ${command}`);
  }

  const dataDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(app.getPath("logs"), { recursive: true });
  backendLogPath = path.join(app.getPath("logs"), "backend.log");
  const log = fs.createWriteStream(backendLogPath, { flags: "w" });

  backend = spawn(command, [...args, "--port", String(port), "--watch-stdin"], {
    env: {
      ...process.env,
      // Le ffmpeg embarqué passe devant celui du système : même build partout.
      PATH: `${ffmpegDir}${path.delimiter}${process.env.PATH || ""}`,
      STONE_STUDIO_DATA_DIR: dataDir,
      PYTHONUNBUFFERED: "1",
      PYTHONIOENCODING: "utf-8",
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  backend.stdout.pipe(log);
  backend.stderr.pipe(log);
  backend.on("exit", (code) => {
    backend = null;
    if (!quitting) {
      dialog.showErrorBox(
        "Stone Studio",
        `Le serveur interne s'est arrêté (code ${code}).\nJournal : ${backendLogPath}`,
      );
      app.quit();
    }
  });
}

function waitForServer(url) {
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (!backend) return reject(new Error("Le serveur s'est arrêté pendant le démarrage."));
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) return reject(new Error("Le serveur n'a pas démarré à temps."));
        setTimeout(attempt, 150);
      });
      req.setTimeout(2000, () => req.destroy());
    };
    attempt();
  });
}

function isAppUrl(url) {
  return baseUrl && url.startsWith(baseUrl);
}

function configureSession() {
  const ses = session.defaultSession;
  const allowed = new Set(["media", "display-capture", "fullscreen", "clipboard-sanitized-write"]);

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(allowed.has(permission) && isAppUrl(details.requestingUrl || wc.getURL()));
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
    return allowed.has(permission) && isAppUrl(`${requestingOrigin}/`);
  });

  // Electron ne fournit pas de sélecteur d'écran pour getDisplayMedia : on utilise celui du
  // système quand il existe (macOS 15+), sinon un choix simple parmi les écrans.
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const screens = await desktopCapturer.getSources({ types: ["screen"] });
      if (!screens.length) return callback({});
      let source = screens[0];
      if (screens.length > 1) {
        const { response } = await dialog.showMessageBox(mainWindow, {
          type: "question",
          message: "Quel écran enregistrer ?",
          buttons: [...screens.map((s) => s.name), "Annuler"],
          cancelId: screens.length,
        });
        if (response === screens.length) return callback({});
        source = screens[response];
      }
      const audio = request.audioRequested && process.platform === "win32" ? "loopback" : undefined;
      callback(audio ? { video: source, audio } : { video: source });
    } catch {
      callback({});
    }
  }, { useSystemPicker: true });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: "Stone Studio",
    // macOS et Windows prennent l'icône de l'exécutable ; Linux l'attend sur la fenêtre.
    ...(process.platform === "linux" ? { icon: ICON_PATH } : {}),
    backgroundColor: "#faf9f5",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.loadFile(path.join(__dirname, "loading.html"));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAppUrl(url)) shell.openExternal(url);
    return { action: isAppUrl(url) ? "allow" : "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file:") || isAppUrl(url)) return;
    event.preventDefault();
    shell.openExternal(url);
  });
  mainWindow.on("closed", () => { mainWindow = null; });
}

function stopBackend() {
  quitting = true;
  if (backend) {
    backend.stdin.end();
    backend.kill();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    // En développement, le Dock afficherait sinon l'icône générique d'Electron.
    if (process.platform === "darwin" && !app.isPackaged) app.dock.setIcon(ICON_PATH);
    createWindow();
    try {
      const port = await getFreePort();
      baseUrl = `http://127.0.0.1:${port}/`;
      configureSession();
      startBackend(port);
      await waitForServer(baseUrl);
      if (mainWindow) mainWindow.loadURL(`${baseUrl}studio`);
    } catch (err) {
      quitting = true;
      dialog.showErrorBox("Stone Studio", `${err.message}${backendLogPath ? `\nJournal : ${backendLogPath}` : ""}`);
      app.quit();
    }
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", stopBackend);
}
