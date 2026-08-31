const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const videoStage = document.getElementById("videoStage");
const preview = document.getElementById("preview");
const info = document.getElementById("info");
const trimBtn = document.getElementById("trimBtn");
const previewBtn = document.getElementById("previewBtn");
const addSegmentBtn = document.getElementById("addSegmentBtn");
const status = document.getElementById("status");

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
const pickProjectLink = document.getElementById("pickProjectLink");
const progressWrap = document.getElementById("progressWrap");
const progressFill = document.getElementById("progressFill");
const progressLabel = document.getElementById("progressLabel");
const downloadBtn = document.getElementById("downloadBtn");

let selectedFile = null;
let pendingDownload = null;
let mediaDuration = 0;
let startTime = 0;
let endTime = 0;
let dragging = null; // "start" | "end" | null
let previewStopHandler = null;
let segments = []; // [{ start: seconds, end: seconds }]

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
  progressWrap.hidden = true;
  downloadBtn.hidden = true;
  document.getElementById("sendToWrap").hidden = true;
  pendingDownload = null;
  segments = [];
  renderSegments();

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
    addSegmentBtn.disabled = false;
    playhead.hidden = false;
    updatePlayhead();
  };

  dropzone.querySelector(".dropzone-title").textContent = file.name;
}

function updatePlayhead() {
  if (!mediaDuration) return;
  const pct = (preview.currentTime / mediaDuration) * 100;
  playhead.style.left = `${pct}%`;
}

function tickPlayhead() {
  updatePlayhead();
  if (!preview.paused && !preview.ended) {
    requestAnimationFrame(tickPlayhead);
  }
}

preview.addEventListener("play", () => requestAnimationFrame(tickPlayhead));
preview.addEventListener("timeupdate", updatePlayhead);
preview.addEventListener("seeking", updatePlayhead);

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

const SCISSORS_ICON = `<span class="icon"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="4" r="1.6"/><circle cx="4" cy="12" r="1.6"/><path d="M5.3 5L14 14M5.3 11L14 2"/></svg></span>`;
const PLAY_ICON = `<span class="icon"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 2.7v10.6a.5.5 0 0 0 .77.42l8.4-5.3a.5.5 0 0 0 0-.84l-8.4-5.3a.5.5 0 0 0-.77.42z"/></svg></span>`;
const CLOSE_ICON = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>`;

function renderSegments() {
  renderSegmentMarkers();

  if (segments.length === 0) {
    segmentsList.innerHTML = `<div class="segments-empty">Aucun morceau ajouté — le bouton ci-dessous exportera la sélection en cours.</div>`;
    trimBtn.innerHTML = `${SCISSORS_ICON} Découper`;
    previewBtn.innerHTML = `${PLAY_ICON} Prévisualiser`;
    return;
  }

  segmentsList.innerHTML = segments
    .map(
      (seg, i) => `
      <div class="segment-item" data-index="${i}" title="Cliquer pour prévisualiser ce morceau">
        <span>
          <span class="segment-label">${i + 1}. ${secondsToTimestamp(seg.start)} → ${secondsToTimestamp(seg.end)}</span>
          <span class="segment-duration">(${secondsToTimestamp(seg.end - seg.start)})</span>
        </span>
        <button class="segment-remove" data-index="${i}" title="Retirer">${CLOSE_ICON}</button>
      </div>`
    )
    .join("");

  segmentsList.querySelectorAll(".segment-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".segment-remove")) return;
      const seg = segments[Number(el.dataset.index)];
      playRanges([seg]);
    });
  });

  segmentsList.querySelectorAll(".segment-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      segments.splice(Number(btn.dataset.index), 1);
      renderSegments();
    });
  });

  trimBtn.innerHTML = segments.length > 1 ? `${SCISSORS_ICON} Découper et combiner` : `${SCISSORS_ICON} Découper`;
  previewBtn.innerHTML =
    segments.length > 1 ? `${PLAY_ICON} Prévisualiser l'enchaînement` : `${PLAY_ICON} Prévisualiser`;
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

function playRanges(ranges) {
  if (!mediaDuration || ranges.length === 0) return;

  if (previewStopHandler) {
    preview.removeEventListener("timeupdate", previewStopHandler);
    previewStopHandler = null;
  }

  let i = 0;
  preview.currentTime = ranges[0].start;
  preview.play();

  previewStopHandler = () => {
    if (preview.currentTime < ranges[i].end) return;

    i += 1;
    if (i >= ranges.length) {
      preview.pause();
      preview.removeEventListener("timeupdate", previewStopHandler);
      previewStopHandler = null;
      return;
    }

    preview.currentTime = ranges[i].start;
  };
  preview.addEventListener("timeupdate", previewStopHandler);
}

previewBtn.addEventListener("click", () => {
  // Si des morceaux ont été ajoutés, prévisualise l'enchaînement complet (comme le rendu final).
  // Sinon, prévisualise juste la sélection en cours sur la timeline.
  playRanges(segments.length > 0 ? segments : [{ start: startTime, end: endTime }]);
});

addSegmentBtn.addEventListener("click", () => {
  const addedEnd = endTime;
  segments.push({ start: startTime, end: endTime });
  segments.sort((a, b) => a.start - b.start);
  renderSegments();

  // Prépare la sélection du prochain morceau juste après celui qui vient d'être ajouté.
  if (addedEnd < mediaDuration - MIN_GAP) {
    startTime = addedEnd;
    endTime = mediaDuration;
    preview.currentTime = startTime;
    updateUI();
  }
});

function setProgress(percent, label) {
  progressWrap.hidden = false;
  progressFill.style.width = `${percent}%`;
  progressLabel.textContent = label;
}

function pollTrimProgress(jobId) {
  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/trim-media/${jobId}/progress`);
        if (!res.ok) throw new Error("Tâche introuvable");
        const job = await res.json();

        if (job.status === "processing") {
          setProgress(job.percent, `Découpage en cours... ${job.percent.toFixed(0)}%`);
        } else if (job.status === "done") {
          clearInterval(interval);
          setProgress(100, "Découpage terminé.");
          resolve(job);
        } else if (job.status === "error") {
          clearInterval(interval);
          reject(new Error(job.error || "Erreur inconnue"));
        }
      } catch (e) {
        clearInterval(interval);
        reject(e);
      }
    }, 600);
  });
}

trimBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  const toExport = segments.length > 0 ? segments : [{ start: startTime, end: endTime }];

  trimBtn.disabled = true;
  downloadBtn.hidden = true;
  pendingDownload = null;
  status.className = "status";
  status.textContent = "";
  setProgress(0, toExport.length > 1 ? "Démarrage du découpage et de la combinaison..." : "Démarrage du découpage...");

  const formData = new FormData();
  formData.append("media", selectedFile);
  formData.append(
    "segments",
    JSON.stringify(toExport.map((s) => ({ start: secondsToTimestamp(s.start), end: secondsToTimestamp(s.end) })))
  );

  try {
    const startRes = await fetch("/api/trim-media", { method: "POST", body: formData });
    if (!startRes.ok) {
      const err = await startRes.json();
      throw new Error(err.detail || "Erreur inconnue");
    }
    const { job_id } = await startRes.json();

    const job = await pollTrimProgress(job_id);

    pendingDownload = { projectId: job.project_id, name: job.output_name };
    downloadBtn.hidden = false;
    renderSendTo("sendToWrap", job.project_id, "trim_media");

    status.textContent = `Export réussi (${formatBytesCommon(job.output_size)}).`;
    status.className = "status success";
  } catch (e) {
    status.textContent = `Erreur : ${e.message}`;
    status.className = "status error";
    progressWrap.hidden = true;
  } finally {
    trimBtn.disabled = false;
  }
});

downloadBtn.addEventListener("click", () => {
  if (!pendingDownload) return;
  const a = document.createElement("a");
  a.href = `/api/projects/${pendingDownload.projectId}/download`;
  a.download = pendingDownload.name;
  a.click();
});

autoLoadFromUrl(handleFile);
