const setupPanel = document.getElementById("setupPanel");
const captureStage = document.getElementById("captureStage");
const livePreview = document.getElementById("livePreview");
const resultStage = document.getElementById("resultStage");
const resultPreview = document.getElementById("resultPreview");
const recBadge = document.getElementById("recBadge");
const recState = document.getElementById("recState");
const timerRow = document.getElementById("timerRow");
const timer = document.getElementById("timer");
const sizeLabel = document.getElementById("sizeLabel");
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const stopBtn = document.getElementById("stopBtn");
const restartBtn = document.getElementById("restartBtn");
const saveBtn = document.getElementById("saveBtn");
const status = document.getElementById("status");
const info = document.getElementById("info");

let captureStream = null; // flux écran (+ son système)
let micStream = null;
let audioContext = null;
let recorder = null;
let chunks = [];
let recordedBlob = null;
let recordedName = "";
let recordedBytes = 0;
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

  const { stream, videoTrack, fps } = built;
  const settings = videoTrack.getSettings();

  chunks = [];
  recordedBytes = 0;
  recordedBlob = null;
  const mimeType = pickMimeType();

  recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: videoBitrate(settings.height || 720, fps),
  });

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) {
      chunks.push(e.data);
      recordedBytes += e.data.size;
    }
  };

  recorder.onstop = () => finishRecording(mimeType);

  // L'utilisateur peut arrêter le partage depuis la barre du navigateur.
  videoTrack.addEventListener("ended", stopRecording);

  livePreview.srcObject = stream;
  recorder.start(1000);

  startedAt = Date.now();
  pausedTotal = 0;
  pausedAt = 0;
  timer.textContent = "00:00";
  sizeLabel.textContent = "0.0 MB";

  setupPanel.hidden = true;
  resultStage.hidden = true;
  saveBtn.hidden = true;
  restartBtn.hidden = true;
  info.innerHTML = "";
  captureStage.hidden = false;
  timerRow.hidden = false;
  recBadge.hidden = false;
  recState.textContent = "REC";
  recBadge.classList.remove("paused");
  startBtn.hidden = true;
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
  releaseStreams();
  livePreview.srcObject = null;

  recordedBlob = new Blob(chunks, { type: mimeType || "video/webm" });
  recordedName = timestampName();

  captureStage.hidden = true;
  recBadge.hidden = true;
  pauseBtn.hidden = true;
  stopBtn.hidden = true;
  restartBtn.hidden = false;
  saveBtn.hidden = false;
  saveBtn.disabled = false;

  resultPreview.src = URL.createObjectURL(recordedBlob);
  resultStage.hidden = false;

  timer.textContent = formatClock(duration);
  sizeLabel.textContent = formatBytesCommon(recordedBlob.size);

  info.innerHTML = `
    <div><span>Nom du fichier</span><span>${recordedName}</span></div>
    <div><span>Durée</span><span>${formatClock(duration)}</span></div>
    <div><span>Taille brute</span><span>${formatBytesCommon(recordedBlob.size)}</span></div>
  `;

  setStatus("Enregistrement terminé. Vérifiez l'aperçu puis enregistrez-le.", "success");
}

restartBtn.addEventListener("click", () => {
  if (resultPreview.src) URL.revokeObjectURL(resultPreview.src);
  resultPreview.removeAttribute("src");
  recordedBlob = null;
  chunks = [];

  resultStage.hidden = true;
  timerRow.hidden = true;
  restartBtn.hidden = true;
  saveBtn.hidden = true;
  info.innerHTML = "";
  setupPanel.hidden = false;
  startBtn.hidden = false;
  startBtn.disabled = false;
  setStatus("");
});

saveBtn.addEventListener("click", async () => {
  if (!recordedBlob) return;

  const format = document.getElementById("format").value;
  saveBtn.disabled = true;
  restartBtn.disabled = true;
  setStatus("Finalisation du fichier (conversion ffmpeg)…");

  const extension = (recordedBlob.type || "").includes("mp4") ? "mp4" : "webm";
  const formData = new FormData();
  formData.append("recording", recordedBlob, `capture.${extension}`);
  formData.append("format", format);
  formData.append("name", recordedName);

  try {
    const res = await fetch("/api/screen-record", { method: "POST", body: formData });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Erreur inconnue");
    }

    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${recordedName}.${format}`;
    a.click();
    URL.revokeObjectURL(a.href);

    setStatus("Enregistrement ajouté à vos projets.", "success");
  } catch (e) {
    setStatus(`Erreur : ${e.message}`, "error");
    saveBtn.disabled = false;
  } finally {
    restartBtn.disabled = false;
  }
});

window.addEventListener("beforeunload", (e) => {
  if (recorder && recorder.state !== "inactive") {
    e.preventDefault();
    e.returnValue = "";
  }
});
