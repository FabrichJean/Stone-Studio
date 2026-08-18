const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const videoStage = document.getElementById("videoStage");
const preview = document.getElementById("preview");
const info = document.getElementById("info");
const trimBtn = document.getElementById("trimBtn");
const previewBtn = document.getElementById("previewBtn");
const status = document.getElementById("status");

const track = document.getElementById("trimTrack");
const range = document.getElementById("trimRange");
const handleStart = document.getElementById("handleStart");
const handleEnd = document.getElementById("handleEnd");
const startLabel = document.getElementById("startLabel");
const endLabel = document.getElementById("endLabel");
const durationLabel = document.getElementById("durationLabel");

let selectedFile = null;
let mediaDuration = 0;
let startTime = 0;
let endTime = 0;
let dragging = null; // "start" | "end" | null
let previewStopHandler = null;

dropzone.addEventListener("click", () => fileInput.click());

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});

dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));

dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener("change", () => {
  if (fileInput.files.length) handleFile(fileInput.files[0]);
});

function formatBytes(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function secondsToTimestamp(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function handleFile(file) {
  selectedFile = file;
  status.textContent = "";
  status.className = "status";

  const url = URL.createObjectURL(file);
  preview.src = url;
  videoStage.hidden = false;
  dropzone.hidden = true;

  preview.onloadedmetadata = () => {
    mediaDuration = preview.duration;
    startTime = 0;
    endTime = mediaDuration;

    info.innerHTML = `
      <div><span>Nom du fichier</span><span>${file.name}</span></div>
      <div><span>Durée</span><span>${secondsToTimestamp(mediaDuration)}</span></div>
      <div><span>Taille</span><span>${formatBytes(file.size)}</span></div>
    `;

    updateUI();
    trimBtn.disabled = false;
    previewBtn.disabled = false;
  };

  dropzone.querySelector(".dropzone-title").textContent = file.name;
}

function updateUI() {
  const startPct = (startTime / mediaDuration) * 100;
  const endPct = (endTime / mediaDuration) * 100;

  handleStart.style.left = `${startPct}%`;
  handleEnd.style.left = `${endPct}%`;
  range.style.left = `${startPct}%`;
  range.style.right = `${100 - endPct}%`;

  startLabel.textContent = secondsToTimestamp(startTime);
  endLabel.textContent = secondsToTimestamp(endTime);
  durationLabel.textContent = `durée : ${secondsToTimestamp(endTime - startTime)}`;
}

function positionToTime(clientX) {
  const rect = track.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return ratio * mediaDuration;
}

const MIN_GAP = 0.2;

function startDrag(which) {
  return (e) => {
    e.preventDefault();
    dragging = which;
  };
}

handleStart.addEventListener("pointerdown", startDrag("start"));
handleEnd.addEventListener("pointerdown", startDrag("end"));

window.addEventListener("pointermove", (e) => {
  if (!dragging || !mediaDuration) return;
  const t = positionToTime(e.clientX);

  if (dragging === "start") {
    startTime = Math.min(t, endTime - MIN_GAP);
    startTime = Math.max(0, startTime);
  } else {
    endTime = Math.max(t, startTime + MIN_GAP);
    endTime = Math.min(mediaDuration, endTime);
  }

  preview.currentTime = dragging === "start" ? startTime : endTime;
  updateUI();
});

window.addEventListener("pointerup", () => {
  dragging = null;
});

track.addEventListener("pointerdown", (e) => {
  if (e.target === handleStart || e.target === handleEnd || !mediaDuration) return;
  const t = positionToTime(e.clientX);
  const distToStart = Math.abs(t - startTime);
  const distToEnd = Math.abs(t - endTime);

  if (distToStart <= distToEnd) {
    startTime = Math.min(t, endTime - MIN_GAP);
    dragging = "start";
  } else {
    endTime = Math.max(t, startTime + MIN_GAP);
    dragging = "end";
  }

  preview.currentTime = dragging === "start" ? startTime : endTime;
  updateUI();
});

previewBtn.addEventListener("click", () => {
  if (!mediaDuration) return;

  if (previewStopHandler) {
    preview.removeEventListener("timeupdate", previewStopHandler);
  }

  preview.currentTime = startTime;
  preview.play();

  previewStopHandler = () => {
    if (preview.currentTime >= endTime) {
      preview.pause();
      preview.removeEventListener("timeupdate", previewStopHandler);
      previewStopHandler = null;
    }
  };
  preview.addEventListener("timeupdate", previewStopHandler);
});

trimBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  trimBtn.disabled = true;
  status.className = "status";
  status.textContent = "Découpage en cours...";

  const formData = new FormData();
  formData.append("media", selectedFile);
  formData.append("start", secondsToTimestamp(startTime));
  formData.append("end", secondsToTimestamp(endTime));

  try {
    const res = await fetch("/api/trim-media", { method: "POST", body: formData });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Erreur inconnue");
    }

    const blob = await res.blob();
    const stem = selectedFile.name.replace(/\.[^/.]+$/, "");
    const ext = selectedFile.name.split(".").pop();

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${stem}_trim.${ext}`;
    a.click();

    status.textContent = "Segment découpé avec succès.";
    status.className = "status success";
  } catch (e) {
    status.textContent = `Erreur : ${e.message}`;
    status.className = "status error";
  } finally {
    trimBtn.disabled = false;
  }
});
