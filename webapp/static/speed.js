const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const videoStage = document.getElementById("videoStage");
const preview = document.getElementById("preview");
const info = document.getElementById("info");
const status = document.getElementById("status");
const pickProjectLink = document.getElementById("pickProjectLink");

const modeSection = document.getElementById("modeSection");
const modeToggle = document.getElementById("modeToggle");
const globalPanel = document.getElementById("globalPanel");
const segmentsPanel = document.getElementById("segmentsPanel");
const globalSpeed = document.getElementById("globalSpeed");
const segmentSpeed = document.getElementById("segmentSpeed");
const applyBtn = document.getElementById("applyBtn");

const track = document.getElementById("trimTrack");
const range = document.getElementById("trimRange");
const segmentMarkers = document.getElementById("segmentMarkers");
const playhead = document.getElementById("playhead");
const handleStart = document.getElementById("handleStart");
const handleEnd = document.getElementById("handleEnd");
const startLabel = document.getElementById("startLabel");
const endLabel = document.getElementById("endLabel");
const durationLabel = document.getElementById("durationLabel");
const segmentsList = document.getElementById("segmentsList");
const previewBtn = document.getElementById("previewBtn");
const addSegmentBtn = document.getElementById("addSegmentBtn");

let selectedFile = null;
let mediaDuration = 0;
let startTime = 0;
let endTime = 0;
let dragging = null;
let previewStopHandler = null;
let segments = []; // [{ start: seconds, end: seconds, factor: number }]
let mode = "global";

dropzone.addEventListener("click", () => fileInput.click());
pickProjectLink.addEventListener("click", (e) => {
  e.stopPropagation();
  openProjectPicker(handleFile);
});

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
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  document.getElementById("sendToWrap").hidden = true;
  segments = [];
  renderSegments();

  const url = URL.createObjectURL(file);
  preview.src = url;
  videoStage.hidden = false;
  dropzone.hidden = true;
  modeSection.hidden = false;

  preview.onloadedmetadata = () => {
    mediaDuration = preview.duration;
    startTime = 0;
    endTime = mediaDuration;

    info.innerHTML = `
      <div><span>Nom du fichier</span><span>${file.name}</span></div>
      <div><span>Durée</span><span>${secondsToTimestamp(mediaDuration)}</span></div>
      <div><span>Taille</span><span>${formatBytes(file.size)}</span></div>
    `;

    updateTimeline();
    playhead.hidden = false;
    updatePlayhead();
    previewBtn.disabled = false;
    addSegmentBtn.disabled = false;
    applyBtn.disabled = false;
  };

  dropzone.querySelector(".dropzone-title").textContent = file.name;
}

/* ---------- Bascule de mode ---------- */

modeToggle.querySelectorAll(".mode-toggle-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    mode = btn.dataset.mode;
    modeToggle.querySelectorAll(".mode-toggle-btn").forEach((b) => b.classList.toggle("active", b === btn));
    globalPanel.hidden = mode !== "global";
    segmentsPanel.hidden = mode !== "segments";
  });
});

/* ---------- Timeline (mode "par morceau") ---------- */

function updateTimeline() {
  if (!mediaDuration) return;
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

function renderSegmentMarkers() {
  segmentMarkers.innerHTML = "";
  segments.forEach((seg) => {
    const marker = document.createElement("div");
    marker.className = "segment-marker";
    marker.style.left = `${(seg.start / mediaDuration) * 100}%`;
    marker.style.width = `${((seg.end - seg.start) / mediaDuration) * 100}%`;
    segmentMarkers.appendChild(marker);
  });
}

function renderSegments() {
  renderSegmentMarkers();

  if (segments.length === 0) {
    segmentsList.innerHTML = `<div class="segments-empty">Aucun morceau ajouté.</div>`;
    return;
  }

  segmentsList.innerHTML = segments
    .map(
      (seg, i) => `
      <div class="segment-item" data-index="${i}" title="Cliquer pour prévisualiser ce morceau">
        <span>
          <span class="segment-label">${i + 1}. ${secondsToTimestamp(seg.start)} → ${secondsToTimestamp(seg.end)}</span>
          <span class="segment-duration">(${secondsToTimestamp(seg.end - seg.start)})</span>
          <span class="segment-speed-tag">${seg.factor}x</span>
        </span>
        <button class="segment-remove" data-index="${i}" title="Retirer">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
        </button>
      </div>`
    )
    .join("");

  segmentsList.querySelectorAll(".segment-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".segment-remove")) return;
      const seg = segments[Number(el.dataset.index)];
      preview.currentTime = seg.start;
      preview.playbackRate = seg.factor;
      preview.play();
      previewStopHandler = () => {
        if (preview.currentTime >= seg.end) {
          preview.pause();
          preview.playbackRate = 1;
          preview.removeEventListener("timeupdate", previewStopHandler);
        }
      };
      preview.addEventListener("timeupdate", previewStopHandler);
    });
  });

  segmentsList.querySelectorAll(".segment-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      segments.splice(Number(btn.dataset.index), 1);
      renderSegments();
    });
  });
}

function positionToTime(clientX) {
  const rect = track.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return ratio * mediaDuration;
}

const MIN_GAP = 0.2;

handleStart.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  dragging = "start";
});
handleEnd.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  dragging = "end";
});

window.addEventListener("pointermove", (e) => {
  if (!dragging || !mediaDuration) return;
  const t = positionToTime(e.clientX);

  if (dragging === "start") {
    startTime = Math.max(0, Math.min(t, endTime - MIN_GAP));
  } else {
    endTime = Math.min(mediaDuration, Math.max(t, startTime + MIN_GAP));
  }

  preview.currentTime = dragging === "start" ? startTime : endTime;
  updateTimeline();
});

window.addEventListener("pointerup", () => {
  dragging = null;
});

track.addEventListener("pointerdown", (e) => {
  if (e.target === handleStart || e.target === handleEnd || !mediaDuration) return;
  const t = positionToTime(e.clientX);
  if (Math.abs(t - startTime) <= Math.abs(t - endTime)) {
    startTime = Math.min(t, endTime - MIN_GAP);
    dragging = "start";
  } else {
    endTime = Math.max(t, startTime + MIN_GAP);
    dragging = "end";
  }
  preview.currentTime = dragging === "start" ? startTime : endTime;
  updateTimeline();
});

function updatePlayhead() {
  if (!mediaDuration) return;
  playhead.style.left = `${(preview.currentTime / mediaDuration) * 100}%`;
}

function tickPlayhead() {
  updatePlayhead();
  if (!preview.paused && !preview.ended) requestAnimationFrame(tickPlayhead);
}

preview.addEventListener("play", () => requestAnimationFrame(tickPlayhead));
preview.addEventListener("timeupdate", updatePlayhead);
preview.addEventListener("seeking", updatePlayhead);

previewBtn.addEventListener("click", () => {
  if (!mediaDuration) return;
  if (previewStopHandler) preview.removeEventListener("timeupdate", previewStopHandler);

  preview.currentTime = startTime;
  preview.playbackRate = 1;
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

addSegmentBtn.addEventListener("click", () => {
  const addedEnd = endTime;
  segments.push({ start: startTime, end: endTime, factor: parseFloat(segmentSpeed.value) });
  segments.sort((a, b) => a.start - b.start);
  renderSegments();

  // Prépare la sélection du prochain morceau juste après celui qui vient d'être ajouté.
  if (addedEnd < mediaDuration - MIN_GAP) {
    startTime = addedEnd;
    endTime = mediaDuration;
    preview.currentTime = startTime;
    updateTimeline();
  }
});

/* ---------- Application ---------- */

applyBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  if (preview.playbackRate !== 1) preview.playbackRate = 1;

  applyBtn.disabled = true;
  status.className = "status";
  status.textContent = "Traitement en cours...";

  const formData = new FormData();
  formData.append("media", selectedFile);
  formData.append("mode", mode);

  if (mode === "global") {
    formData.append("factor", globalSpeed.value);
  } else {
    if (segments.length === 0) {
      status.textContent = "Ajoutez au moins un morceau.";
      status.className = "status error";
      applyBtn.disabled = false;
      return;
    }
    formData.append(
      "segments",
      JSON.stringify(
        segments.map((s) => ({ start: secondsToTimestamp(s.start), end: secondsToTimestamp(s.end), factor: s.factor }))
      )
    );
  }

  try {
    const res = await fetch("/api/speed-media", { method: "POST", body: formData });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Erreur inconnue");
    }

    const projectId = res.headers.get("X-Project-Id");
    const blob = await res.blob();
    const stem = selectedFile.name.replace(/\.[^/.]+$/, "");
    const ext = selectedFile.name.split(".").pop();

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${stem}_speed.${ext}`;
    a.click();

    if (projectId) renderSendTo("sendToWrap", projectId, "speed_media");

    status.textContent = "Vitesse appliquée avec succès.";
    status.className = "status success";
  } catch (e) {
    status.textContent = `Erreur : ${e.message}`;
    status.className = "status error";
  } finally {
    applyBtn.disabled = false;
  }
});

autoLoadFromUrl(handleFile);
