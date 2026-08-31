const setupPanel = document.getElementById("setupPanel");
const selectHint = document.getElementById("selectHint");
const captureStage = document.getElementById("captureStage");
const livePreview = document.getElementById("livePreview");
const cropOverlay = document.getElementById("cropOverlay");
const cropBox = document.getElementById("cropBox");
const resultStage = document.getElementById("resultStage");
const resultPreview = document.getElementById("resultPreview");
const recBadge = document.getElementById("recBadge");
const recState = document.getElementById("recState");
const timerRow = document.getElementById("timerRow");
const timer = document.getElementById("timer");
const sizeLabel = document.getElementById("sizeLabel");
const startBtn = document.getElementById("startBtn");
const resetCropBtn = document.getElementById("resetCropBtn");
const cancelSelectBtn = document.getElementById("cancelSelectBtn");
const confirmStartBtn = document.getElementById("confirmStartBtn");
const pauseBtn = document.getElementById("pauseBtn");
const stopBtn = document.getElementById("stopBtn");
const restartBtn = document.getElementById("restartBtn");
const downloadBtn = document.getElementById("downloadBtn");
const progressWrap = document.getElementById("progressWrap");
const progressFill = document.getElementById("progressFill");
const progressLabel = document.getElementById("progressLabel");
const sendToWrap = document.getElementById("sendToWrap");
const retryBtn = document.getElementById("retryBtn");
const status = document.getElementById("status");
const info = document.getElementById("info");

const MIN_SELECT = 0.04; // taille minimale (fraction) de la zone dessinée

let captureStream = null; // flux écran (+ son système), brut de getDisplayMedia
let micStream = null;
let audioContext = null;
let pendingStream = null; // flux combiné (vidéo + audio mixé) en attente de confirmation
let pendingVideoTrack = null;
let pendingFps = 30;

let selectRect = null; // { x, y, w, h } en fractions (0..1) de l'aperçu, ou null = écran entier
let dragMode = null; // "draw" | "move" | "resize" | null
let dragHandle = null; // "nw" | "ne" | "sw" | "se"
let dragStart = null;
let dragRectStart = null;

let cropCanvas = null;
let cropRafHandle = null;

let recorder = null;
let chunks = [];
let recordedBlob = null;
let recordedName = "";
let recordedDurationSeconds = 0;
let recordedBytes = 0;
let savedProjectId = null;
let startedAt = 0;
let pausedTotal = 0; // millisecondes cumulées en pause
let pausedAt = 0;
let tickHandle = null;

if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || !window.MediaRecorder) {
  document.getElementById("unsupported").hidden = false;
  startBtn.disabled = true;
}

/* ---------- Utilitaires ---------- */

function setStatus(text, kind = "") {
  status.textContent = text;
  status.className = kind ? `status ${kind}` : "status";
}

function formatClock(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60).toString().padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return h ? `${h}:${m}:${s}` : `${m}:${s}`;
}

function timestampName() {
  const d = new Date();
  const p = (n) => n.toString().padStart(2, "0");
  return `enregistrement_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** MediaRecorder n'accepte pas les mêmes conteneurs selon le navigateur :
 *  on prend le premier disponible, ffmpeg réencode ensuite vers le format voulu. */
function pickMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

function videoBitrate(height, fps) {
  const base = height >= 1080 ? 8_000_000 : height >= 720 ? 5_000_000 : 2_500_000;
  return fps >= 60 ? base * 1.5 : base;
}

/* ---------- Capture ---------- */

async function buildStream() {
  const surface = document.getElementById("surface").value;
  const quality = document.getElementById("quality").value;
  const fps = parseInt(document.getElementById("fps").value, 10);
  const wantSystemAudio = document.getElementById("systemAudio").checked;
  const wantMic = document.getElementById("micAudio").checked;

  const video = { frameRate: { ideal: fps } };
  if (quality !== "native") video.height = { ideal: parseInt(quality, 10) };

  captureStream = await navigator.mediaDevices.getDisplayMedia({
    video,
    audio: wantSystemAudio,
    // Simple indication : le navigateur affiche quand même son propre sélecteur.
    preferCurrentTab: false,
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
    systemAudio: wantSystemAudio ? "include" : "exclude",
    displaySurface: surface,
  });

  if (wantMic) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      setStatus("Micro indisponible : enregistrement sans micro.", "error");
    }
  }

  const videoTrack = captureStream.getVideoTracks()[0];
  const systemTracks = captureStream.getAudioTracks();
  const micTracks = micStream ? micStream.getAudioTracks() : [];

  const stream = new MediaStream([videoTrack]);

  if (systemTracks.length && micTracks.length) {
    // Deux sources audio : on les mixe en une seule piste, sinon MediaRecorder
    // n'en garderait qu'une.
    audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();
    audioContext.createMediaStreamSource(new MediaStream(systemTracks)).connect(destination);
    audioContext.createMediaStreamSource(new MediaStream(micTracks)).connect(destination);
    destination.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  } else {
    [...systemTracks, ...micTracks].forEach((t) => stream.addTrack(t));
  }

  return { stream, videoTrack, fps };
}

function releaseStreams() {
  if (captureStream) captureStream.getTracks().forEach((t) => t.stop());
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  if (audioContext) audioContext.close();
  captureStream = micStream = audioContext = null;
  pendingStream = pendingVideoTrack = null;
  stopCropLoop();
}

function startTicker() {
  stopTicker();
  tickHandle = setInterval(() => {
    if (recorder && recorder.state === "recording") {
      timer.textContent = formatClock(Date.now() - startedAt - pausedTotal);
    }
    sizeLabel.textContent = formatBytesCommon(recordedBytes);
  }, 250);
}

function stopTicker() {
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = null;
}

/* ---------- Sélection de la zone à capturer ---------- */

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function pointToFraction(clientX, clientY) {
  const rect = livePreview.getBoundingClientRect();
  return {
    x: clamp01((clientX - rect.left) / rect.width),
    y: clamp01((clientY - rect.top) / rect.height),
  };
}

function resizeRect(start, handle, cur) {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;

  if (handle.includes("w")) left = Math.min(cur.x, right - MIN_SELECT);
  if (handle.includes("e")) right = Math.max(cur.x, left + MIN_SELECT);
  if (handle.includes("n")) top = Math.min(cur.y, bottom - MIN_SELECT);
  if (handle.includes("s")) bottom = Math.max(cur.y, top + MIN_SELECT);

  return {
    x: clamp01(left),
    y: clamp01(top),
    w: clamp01(right) - clamp01(left),
    h: clamp01(bottom) - clamp01(top),
  };
}

function updateCropBox() {
  if (!selectRect) {
    cropBox.hidden = true;
    return;
  }
  const w = livePreview.clientWidth;
  const h = livePreview.clientHeight;
  cropBox.hidden = false;
  cropBox.style.left = `${selectRect.x * w}px`;
  cropBox.style.top = `${selectRect.y * h}px`;
  cropBox.style.width = `${selectRect.w * w}px`;
  cropBox.style.height = `${selectRect.h * h}px`;
}

function enterSelectionMode() {
  selectRect = null;
  cropOverlay.hidden = false;
  cropOverlay.classList.add("drawable");
  cropBox.classList.add("resizable");
  cropBox.hidden = true;
  selectHint.hidden = false;
}

function exitSelectionMode() {
  cropOverlay.hidden = true;
  cropOverlay.classList.remove("drawable");
  cropBox.classList.remove("resizable");
  selectHint.hidden = true;
}

cropBox.addEventListener("pointerdown", (e) => {
  if (e.target.classList.contains("crop-handle") || !selectRect) return;
  e.preventDefault();
  dragMode = "move";
  dragStart = pointToFraction(e.clientX, e.clientY);
  dragRectStart = { ...selectRect };
});

cropBox.querySelectorAll(".crop-handle").forEach((handle) => {
  handle.addEventListener("pointerdown", (e) => {
    if (!selectRect) return;
    e.preventDefault();
    e.stopPropagation();
    dragMode = "resize";
    dragHandle = handle.dataset.handle;
    dragStart = pointToFraction(e.clientX, e.clientY);
    dragRectStart = { ...selectRect };
  });
});

cropOverlay.addEventListener("pointerdown", (e) => {
  if (!cropOverlay.classList.contains("drawable") || e.target !== cropOverlay) return;
  e.preventDefault();
  dragMode = "draw";
  dragStart = pointToFraction(e.clientX, e.clientY);
  selectRect = { x: dragStart.x, y: dragStart.y, w: 0, h: 0 };
  updateCropBox();
});

window.addEventListener("pointermove", (e) => {
  if (!dragMode) return;
  const cur = pointToFraction(e.clientX, e.clientY);

  if (dragMode === "draw") {
    selectRect = {
      x: Math.min(dragStart.x, cur.x),
      y: Math.min(dragStart.y, cur.y),
      w: Math.abs(cur.x - dragStart.x),
      h: Math.abs(cur.y - dragStart.y),
    };
  } else if (dragMode === "move") {
    const dx = cur.x - dragStart.x;
    const dy = cur.y - dragStart.y;
    selectRect = {
      x: Math.max(0, Math.min(1 - dragRectStart.w, dragRectStart.x + dx)),
      y: Math.max(0, Math.min(1 - dragRectStart.h, dragRectStart.y + dy)),
      w: dragRectStart.w,
      h: dragRectStart.h,
    };
  } else if (dragMode === "resize") {
    selectRect = resizeRect(dragRectStart, dragHandle, cur);
  }

  updateCropBox();
});

window.addEventListener("pointerup", () => {
  if (dragMode === "draw" && selectRect && (selectRect.w < MIN_SELECT || selectRect.h < MIN_SELECT)) {
    selectRect = null; // clic sans glisser : annule le dessin, garde l'écran entier
  }
  dragMode = null;
  dragHandle = null;
  updateCropBox();
});

window.addEventListener("resize", () => {
  if (!cropOverlay.hidden) updateCropBox();
});

resetCropBtn.addEventListener("click", () => {
  selectRect = null;
  updateCropBox();
});

/* ---------- Recadrage par canvas ---------- */

function stopCropLoop() {
  if (cropRafHandle) cancelAnimationFrame(cropRafHandle);
  cropRafHandle = null;
  cropCanvas = null;
}

/** Découpe le flux à la zone choisie en redessinant chaque image sur un canvas
 *  (getDisplayMedia ne permet pas de restreindre nativement la capture à une
 *  sous-région de l'écran/fenêtre/onglet). */
function buildCroppedStream(stream, videoTrack, fps, rect) {
  const settings = videoTrack.getSettings();
  const vw = settings.width || livePreview.videoWidth;
  const vh = settings.height || livePreview.videoHeight;

  const sx = Math.round(rect.x * vw);
  const sy = Math.round(rect.y * vh);
  // Largeur/hauteur paires : les encodeurs H.264 exigent des dimensions multiples de 2.
  const sw = Math.max(2, Math.round(rect.w * vw / 2) * 2);
  const sh = Math.max(2, Math.round(rect.h * vh / 2) * 2);

  cropCanvas = document.createElement("canvas");
  cropCanvas.width = sw;
  cropCanvas.height = sh;
  const ctx = cropCanvas.getContext("2d", { alpha: false });

  const draw = () => {
    if (livePreview.readyState >= 2) {
      ctx.drawImage(livePreview, sx, sy, sw, sh, 0, 0, sw, sh);
    }
    cropRafHandle = requestAnimationFrame(draw);
  };
  cropRafHandle = requestAnimationFrame(draw);

  const canvasStream = cropCanvas.captureStream(fps);
  stream.getAudioTracks().forEach((t) => canvasStream.addTrack(t));
  return canvasStream;
}

/* ---------- Actions ---------- */

startBtn.addEventListener("click", async () => {
  setStatus("");
  startBtn.disabled = true;

  let built;
  try {
    built = await buildStream();
  } catch (e) {
    startBtn.disabled = false;
    releaseStreams();
    if (e.name !== "NotAllowedError") setStatus(`Impossible de démarrer la capture : ${e.message}`, "error");
    return;
  }

  pendingStream = built.stream;
  pendingVideoTrack = built.videoTrack;
  pendingFps = built.fps;

  // Si le partage est arrêté depuis la barre du navigateur pendant la sélection.
  pendingVideoTrack.addEventListener("ended", cancelSelection, { once: true });

  livePreview.srcObject = pendingStream;

  setupPanel.hidden = true;
  resultStage.hidden = true;
  retryBtn.hidden = true;
  restartBtn.hidden = true;
  downloadBtn.hidden = true;
  progressWrap.hidden = true;
  sendToWrap.hidden = true;
  savedProjectId = null;
  info.innerHTML = "";
  captureStage.hidden = false;
  startBtn.hidden = true;
  resetCropBtn.hidden = false;
  cancelSelectBtn.hidden = false;
  confirmStartBtn.hidden = false;

  enterSelectionMode();
  setStatus("Choisissez la zone à enregistrer, puis démarrez.");
});

function cancelSelection() {
  releaseStreams();
  livePreview.srcObject = null;
  exitSelectionMode();

  captureStage.hidden = true;
  resetCropBtn.hidden = true;
  cancelSelectBtn.hidden = true;
  confirmStartBtn.hidden = true;
  setupPanel.hidden = false;
  startBtn.hidden = false;
  startBtn.disabled = false;
  setStatus("");
}

cancelSelectBtn.addEventListener("click", cancelSelection);

confirmStartBtn.addEventListener("click", () => {
  const rect = selectRect && selectRect.w >= MIN_SELECT && selectRect.h >= MIN_SELECT ? selectRect : null;
  const finalStream = rect
    ? buildCroppedStream(pendingStream, pendingVideoTrack, pendingFps, rect)
    : pendingStream;

  chunks = [];
  recordedBytes = 0;
  recordedBlob = null;
  const mimeType = pickMimeType();
  const settings = pendingVideoTrack.getSettings();

  const outputHeight = rect ? cropCanvas.height : settings.height || 720;
  recorder = new MediaRecorder(finalStream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: videoBitrate(outputHeight, pendingFps),
  });

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) {
      chunks.push(e.data);
      recordedBytes += e.data.size;
    }
  };

  recorder.onstop = () => finishRecording(mimeType);

  // L'utilisateur peut arrêter le partage depuis la barre du navigateur.
  pendingVideoTrack.removeEventListener("ended", cancelSelection);
  pendingVideoTrack.addEventListener("ended", stopRecording);

  recorder.start(1000);

  startedAt = Date.now();
  pausedTotal = 0;
  pausedAt = 0;
  timer.textContent = "00:00";
  sizeLabel.textContent = "0.0 MB";

  exitSelectionMode();
  resetCropBtn.hidden = true;
  cancelSelectBtn.hidden = true;
  confirmStartBtn.hidden = true;
  timerRow.hidden = false;
  recBadge.hidden = false;
  recState.textContent = "REC";
  recBadge.classList.remove("paused");
  pauseBtn.hidden = false;
  stopBtn.hidden = false;
  pauseBtn.innerHTML = `${iconHtml("pause")} Pause`;

  startTicker();
  setStatus("Enregistrement en cours…");
});

pauseBtn.addEventListener("click", () => {
  if (!recorder) return;

  if (recorder.state === "recording") {
    recorder.pause();
    pausedAt = Date.now();
    recState.textContent = "PAUSE";
    recBadge.classList.add("paused");
    pauseBtn.innerHTML = `${iconHtml("play")} Reprendre`;
    setStatus("Enregistrement en pause.");
  } else if (recorder.state === "paused") {
    recorder.resume();
    pausedTotal += Date.now() - pausedAt;
    recState.textContent = "REC";
    recBadge.classList.remove("paused");
    pauseBtn.innerHTML = `${iconHtml("pause")} Pause`;
    setStatus("Enregistrement en cours…");
  }
});

function stopRecording() {
  if (!recorder || recorder.state === "inactive") return;
  // Un arrêt pendant une pause : la dernière pause n'a pas encore été comptée.
  if (recorder.state === "paused") pausedTotal += Date.now() - pausedAt;
  recorder.stop();
}

stopBtn.addEventListener("click", stopRecording);

function finishRecording(mimeType) {
  stopTicker();
  const duration = Math.max(0, Date.now() - startedAt - pausedTotal);
  recordedDurationSeconds = duration / 1000;
  releaseStreams();
  livePreview.srcObject = null;

  recordedBlob = new Blob(chunks, { type: mimeType || "video/webm" });
  recordedName = timestampName();

  captureStage.hidden = true;
  recBadge.hidden = true;
  pauseBtn.hidden = true;
  stopBtn.hidden = true;
  restartBtn.hidden = false;

  resultPreview.src = URL.createObjectURL(recordedBlob);
  resultStage.hidden = false;

  timer.textContent = formatClock(duration);
  sizeLabel.textContent = formatBytesCommon(recordedBlob.size);

  info.innerHTML = `
    <div><span>Nom du fichier</span><span>${recordedName}</span></div>
    <div><span>Durée</span><span>${formatClock(duration)}</span></div>
    <div><span>Taille brute</span><span>${formatBytesCommon(recordedBlob.size)}</span></div>
  `;

  saveRecording();
}

restartBtn.addEventListener("click", () => {
  if (resultPreview.src) URL.revokeObjectURL(resultPreview.src);
  resultPreview.removeAttribute("src");
  recordedBlob = null;
  chunks = [];
  savedProjectId = null;

  resultStage.hidden = true;
  timerRow.hidden = true;
  restartBtn.hidden = true;
  downloadBtn.hidden = true;
  progressWrap.hidden = true;
  sendToWrap.hidden = true;
  retryBtn.hidden = true;
  info.innerHTML = "";
  setupPanel.hidden = false;
  startBtn.hidden = false;
  startBtn.disabled = false;
  setStatus("");
});

function setRecordProgress(percent, label) {
  progressWrap.hidden = false;
  progressFill.style.width = `${percent}%`;
  progressLabel.textContent = label;
}

function pollRecordProgress(jobId) {
  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/screen-record/${jobId}/progress`);
        if (!res.ok) throw new Error("Tâche introuvable");
        const job = await res.json();

        if (job.status === "processing") {
          const label = job.percent >= 100
            ? "Génération de la miniature et enregistrement..."
            : `Finalisation en cours... ${job.percent.toFixed(0)}%`;
          setRecordProgress(job.percent, label);
        } else if (job.status === "done") {
          clearInterval(interval);
          setRecordProgress(100, "Finalisation terminée.");
          resolve(job);
        } else if (job.status === "error") {
          clearInterval(interval);
          reject(new Error(job.error || "Erreur inconnue"));
        }
      } catch (e) {
        clearInterval(interval);
        reject(e);
      }
    }, 300);
  });
}

async function saveRecording() {
  if (!recordedBlob) return;

  const format = document.getElementById("format").value;
  retryBtn.hidden = true;
  downloadBtn.hidden = true;
  sendToWrap.hidden = true;
  restartBtn.disabled = true;
  setRecordProgress(0, "Démarrage de la finalisation...");

  const extension = (recordedBlob.type || "").includes("mp4") ? "mp4" : "webm";
  const formData = new FormData();
  formData.append("recording", recordedBlob, `capture.${extension}`);
  formData.append("format", format);
  formData.append("name", recordedName);
  if (recordedDurationSeconds > 0) formData.append("duration", recordedDurationSeconds);

  try {
    const startRes = await fetch("/api/screen-record", { method: "POST", body: formData });
    if (!startRes.ok) {
      const err = await startRes.json();
      throw new Error(err.detail || "Erreur inconnue");
    }
    const { job_id } = await startRes.json();

    const job = await pollRecordProgress(job_id);

    savedProjectId = job.project_id;
    downloadBtn.hidden = false;
    downloadBtn.disabled = false;
    renderSendTo("sendToWrap", job.project_id, "screen_record");
    setStatus(`Enregistrement ajouté à vos projets : ${job.output_name} (${formatBytesCommon(job.output_size)}).`, "success");
  } catch (e) {
    // La capture n'est que dans le navigateur : on garde de quoi retenter.
    progressWrap.hidden = true;
    setStatus(`Erreur : ${e.message}. L'enregistrement n'est pas encore sauvegardé.`, "error");
    retryBtn.hidden = false;
  } finally {
    restartBtn.disabled = false;
  }
}

retryBtn.addEventListener("click", saveRecording);

downloadBtn.addEventListener("click", async () => {
  if (!savedProjectId) return;

  downloadBtn.disabled = true;
  try {
    const res = await fetch(`/api/projects/${savedProjectId}/download`);
    if (!res.ok) throw new Error("Téléchargement impossible.");
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : `${recordedName}.${document.getElementById("format").value}`;

    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    setStatus(`Erreur de téléchargement : ${e.message}`, "error");
  } finally {
    downloadBtn.disabled = false;
  }
});

window.addEventListener("beforeunload", (e) => {
  if (recorder && recorder.state !== "inactive") {
    e.preventDefault();
    e.returnValue = "";
  }
});
