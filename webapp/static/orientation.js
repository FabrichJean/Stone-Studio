const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const videoStage = document.getElementById("videoStage");
const preview = document.getElementById("preview");
const info = document.getElementById("info");
const status = document.getElementById("status");
const pickProjectLink = document.getElementById("pickProjectLink");

const aspectSection = document.getElementById("aspectSection");
const aspectGrid = document.getElementById("aspectGrid");
const aspectHint = document.getElementById("aspectHint");
const customHint = document.getElementById("customHint");
const cropOverlay = document.getElementById("cropOverlay");
const cropBox = document.getElementById("cropBox");
const zoomSection = document.getElementById("zoomSection");
const zoomGrid = document.getElementById("zoomGrid");
const zoomHint = document.getElementById("zoomHint");
const modeSection = document.getElementById("modeSection");
const modeToggle = document.getElementById("modeToggle");
const globalPanel = document.getElementById("globalPanel");
const segmentsPanel = document.getElementById("segmentsPanel");
const globalActionsEl = document.getElementById("globalActions");
const segmentActionsEl = document.getElementById("segmentActions");
const applyBtn = document.getElementById("applyBtn");
const progressWrap = document.getElementById("progressWrap");
const progressFill = document.getElementById("progressFill");
const progressLabel = document.getElementById("progressLabel");
const downloadBtn = document.getElementById("downloadBtn");
const sendToWrap = document.getElementById("sendToWrap");

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

const TRANSFORMS = {
  rotate_90_cw: "rotate(90deg)",
  rotate_90_ccw: "rotate(-90deg)",
  rotate_180: "rotate(180deg)",
  flip_horizontal: "scaleX(-1)",
  flip_vertical: "scaleY(-1)",
};

const ACTION_LABELS = {
  rotate_90_cw: "90° horaire",
  rotate_90_ccw: "90° antihoraire",
  rotate_180: "180°",
  flip_horizontal: "miroir H",
  flip_vertical: "miroir V",
};

const ROTATE_90_ACTIONS = new Set(["rotate_90_cw", "rotate_90_ccw"]);

const ASPECT_NUMERIC = {
  landscape_16_9: 16 / 9,
  portrait_9_16: 9 / 16,
  square_1_1: 1,
  portrait_4_5: 4 / 5,
};

const ASPECT_LABELS = {
  landscape_16_9: "16:9",
  portrait_9_16: "9:16",
  square_1_1: "1:1",
  portrait_4_5: "4:5",
  custom: "Personnalisé",
};

const MIN_CUSTOM = 0.05; // taille minimale (fraction) du cadre personnalisé

let selectedAspect = "";
let aspectPos = 0.5;
let cropAxis = null; // "x" | "y" | null (null = pas de recadrage nécessaire)
let draggingCrop = false;
let customRect = null; // { x, y, w, h } en fractions (0..1) de l'aperçu — format d'affichage personnalisé
let zoomRect = null; // { x, y, w, h } — zone à zoomer, indépendante du format d'affichage
// Quel rectangle l'overlay dessine/édite actuellement : le format d'affichage personnalisé
// et le zoom réutilisent la même interaction de dessin, mais gardent chacun leur propre
// rectangle en mémoire (les deux peuvent être actifs à la fois).
let cropTarget = null; // "aspect" | "zoom" | null
let customDragMode = null; // "draw" | "move" | "resize" | null
let customHandle = null; // "nw" | "ne" | "sw" | "se"
let customDragStart = null; // point de départ du drag, en fractions
let customRectStart = null; // snapshot du rectangle actif au début du drag

function hasAspectWork() {
  if (!selectedAspect) return false;
  return selectedAspect === "custom" ? !!customRect : true;
}

function hasZoomWork() {
  return !!zoomRect;
}

function activeRect() {
  return cropTarget === "zoom" ? zoomRect : customRect;
}

function setActiveRect(rect) {
  if (cropTarget === "zoom") zoomRect = rect; else customRect = rect;
}

function isDrawable() {
  return cropTarget === "zoom" || (cropTarget === "aspect" && selectedAspect === "custom");
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function pointToFraction(clientX, clientY) {
  const rect = preview.getBoundingClientRect();
  return {
    x: clamp01((clientX - rect.left) / rect.width),
    y: clamp01((clientY - rect.top) / rect.height),
  };
}

function resizeCustomRect(start, handle, cur) {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;

  if (handle.includes("w")) left = Math.min(cur.x, right - MIN_CUSTOM);
  if (handle.includes("e")) right = Math.max(cur.x, left + MIN_CUSTOM);
  if (handle.includes("n")) top = Math.min(cur.y, bottom - MIN_CUSTOM);
  if (handle.includes("s")) bottom = Math.max(cur.y, top + MIN_CUSTOM);

  left = clamp01(left);
  right = clamp01(right);
  top = clamp01(top);
  bottom = clamp01(bottom);

  return { x: left, y: top, w: right - left, h: bottom - top };
}

function updateCropBox() {
  if (cropTarget === "zoom") {
    cropOverlay.hidden = false;
    cropOverlay.classList.add("drawable");
    cropBox.classList.add("resizable");
    aspectHint.hidden = true;
    customHint.hidden = true;
    zoomHint.hidden = false;

    if (!zoomRect) {
      cropBox.hidden = true;
      return;
    }
    const w = preview.clientWidth;
    const h = preview.clientHeight;
    cropBox.hidden = false;
    cropBox.style.left = `${zoomRect.x * w}px`;
    cropBox.style.top = `${zoomRect.y * h}px`;
    cropBox.style.width = `${zoomRect.w * w}px`;
    cropBox.style.height = `${zoomRect.h * h}px`;
    return;
  }

  zoomHint.hidden = true;

  if (!selectedAspect) {
    cropOverlay.hidden = true;
    cropOverlay.classList.remove("drawable");
    cropBox.classList.remove("resizable");
    cropBox.hidden = false;
    aspectHint.hidden = true;
    customHint.hidden = true;
    return;
  }

  if (selectedAspect === "custom") {
    cropOverlay.hidden = false;
    cropOverlay.classList.add("drawable");
    cropBox.classList.add("resizable");
    aspectHint.hidden = true;
    customHint.hidden = false;

    if (!customRect) {
      cropBox.hidden = true;
      return;
    }
    const w = preview.clientWidth;
    const h = preview.clientHeight;
    cropBox.hidden = false;
    cropBox.style.left = `${customRect.x * w}px`;
    cropBox.style.top = `${customRect.y * h}px`;
    cropBox.style.width = `${customRect.w * w}px`;
    cropBox.style.height = `${customRect.h * h}px`;
    return;
  }

  cropOverlay.classList.remove("drawable");
  cropBox.classList.remove("resizable");
  cropBox.hidden = false;
  customHint.hidden = true;

  const w = preview.clientWidth;
  const h = preview.clientHeight;
  if (!w || !h) return;

  const r = ASPECT_NUMERIC[selectedAspect];
  const videoAR = w / h;
  const widthCrop = videoAR > r;

  const boxW = widthCrop ? h * r : w;
  const boxH = widthCrop ? h : w / r;

  cropAxis = widthCrop ? "x" : "y";
  const maxOffset = widthCrop ? w - boxW : h - boxH;
  const offset = maxOffset * aspectPos;

  cropBox.style.width = `${boxW}px`;
  cropBox.style.height = `${boxH}px`;
  cropBox.style.left = `${widthCrop ? offset : 0}px`;
  cropBox.style.top = `${widthCrop ? 0 : offset}px`;

  cropOverlay.hidden = false;
  aspectHint.hidden = maxOffset < 1; // rien à déplacer si le ratio correspond déjà
}

cropBox.addEventListener("pointerdown", (e) => {
  if (isDrawable()) {
    const rect = activeRect();
    if (e.target.classList.contains("crop-handle") || !rect) return;
    e.preventDefault();
    customDragMode = "move";
    customDragStart = pointToFraction(e.clientX, e.clientY);
    customRectStart = { ...rect };
    return;
  }
  e.preventDefault();
  draggingCrop = true;
});

cropBox.querySelectorAll(".crop-handle").forEach((handle) => {
  handle.addEventListener("pointerdown", (e) => {
    const rect = activeRect();
    if (!isDrawable() || !rect) return;
    e.preventDefault();
    e.stopPropagation();
    customDragMode = "resize";
    customHandle = handle.dataset.handle;
    customDragStart = pointToFraction(e.clientX, e.clientY);
    customRectStart = { ...rect };
  });
});

cropOverlay.addEventListener("pointerdown", (e) => {
  if (!isDrawable() || e.target !== cropOverlay) return;
  e.preventDefault();
  customDragMode = "draw";
  customDragStart = pointToFraction(e.clientX, e.clientY);
  setActiveRect({ x: customDragStart.x, y: customDragStart.y, w: 0, h: 0 });
  updateCropBox();
});

window.addEventListener("pointermove", (e) => {
  if (!customDragMode) return;
  const cur = pointToFraction(e.clientX, e.clientY);

  if (customDragMode === "draw") {
    setActiveRect({
      x: Math.min(customDragStart.x, cur.x),
      y: Math.min(customDragStart.y, cur.y),
      w: Math.abs(cur.x - customDragStart.x),
      h: Math.abs(cur.y - customDragStart.y),
    });
  } else if (customDragMode === "move") {
    const dx = cur.x - customDragStart.x;
    const dy = cur.y - customDragStart.y;
    setActiveRect({
      x: Math.max(0, Math.min(1 - customRectStart.w, customRectStart.x + dx)),
      y: Math.max(0, Math.min(1 - customRectStart.h, customRectStart.y + dy)),
      w: customRectStart.w,
      h: customRectStart.h,
    });
  } else if (customDragMode === "resize") {
    setActiveRect(resizeCustomRect(customRectStart, customHandle, cur));
  }

  updateCropBox();
});

window.addEventListener("pointerup", () => {
  if (customDragMode === "draw") {
    const rect = activeRect();
    if (rect && (rect.w < MIN_CUSTOM || rect.h < MIN_CUSTOM)) {
      setActiveRect(null); // clic sans glisser : annule le dessin
      updateCropBox();
    }
  }
  customDragMode = null;
  customHandle = null;
  updateApplyState();
});

window.addEventListener("pointermove", (e) => {
  if (!draggingCrop || !cropAxis) return;
  const rect = preview.getBoundingClientRect();
  const boxW = cropBox.offsetWidth;
  const boxH = cropBox.offsetHeight;

  if (cropAxis === "x") {
    const maxOffset = rect.width - boxW;
    const x = Math.max(0, Math.min(maxOffset, e.clientX - rect.left - boxW / 2));
    aspectPos = maxOffset > 0 ? x / maxOffset : 0.5;
  } else {
    const maxOffset = rect.height - boxH;
    const y = Math.max(0, Math.min(maxOffset, e.clientY - rect.top - boxH / 2));
    aspectPos = maxOffset > 0 ? y / maxOffset : 0.5;
  }
  updateCropBox();
});

window.addEventListener("pointerup", () => {
  draggingCrop = false;
});

window.addEventListener("resize", () => {
  if (selectedAspect) updateCropBox();
});

aspectGrid.querySelectorAll(".orientation-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    selectedAspect = btn.dataset.aspect;
    aspectGrid.querySelectorAll(".orientation-btn").forEach((b) => b.classList.toggle("active", b === btn));
    aspectPos = 0.5;
    if (selectedAspect === "custom") {
      cropTarget = "aspect";
      if (!customRect) customRect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
    } else if (cropTarget === "aspect") {
      cropTarget = zoomRect ? "zoom" : null;
    }
    updateCropBox();
    updateApplyState();
  });
});

zoomGrid.querySelectorAll(".orientation-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    zoomGrid.querySelectorAll(".orientation-btn").forEach((b) => b.classList.toggle("active", b === btn));
    if (btn.dataset.zoom === "custom") {
      cropTarget = "zoom";
      if (!zoomRect) zoomRect = { x: 0.2, y: 0.2, w: 0.6, h: 0.6 };
    } else {
      zoomRect = null;
      if (cropTarget === "zoom") cropTarget = selectedAspect === "custom" ? "aspect" : null;
    }
    updateCropBox();
    updateApplyState();
  });
});

let selectedFile = null;
let pendingDownload = null;
let mediaDuration = 0;
let startTime = 0;
let endTime = 0;
let dragging = null;
let previewStopHandler = null;
let segments = []; // [{ start, end, actions: string[] }]
let mode = "global";
let globalActions = []; // ordre de clic = ordre d'application
let currentSegmentActions = [];

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

function toggleAction(list, action) {
  const idx = list.indexOf(action);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(action);
}

function applyPreviewTransform(actions) {
  if (!actions || actions.length === 0) {
    preview.style.transform = "";
    return;
  }

  let transform = actions.map((a) => TRANSFORMS[a]).join(" ");

  if (actions.some((a) => ROTATE_90_ACTIONS.has(a))) {
    const { width, height } = preview.getBoundingClientRect();
    const fitScale = Math.min(width / height, height / width);
    transform += ` scale(${fitScale})`;
  }

  preview.style.transform = transform;
}

function handleFile(file) {
  selectedFile = file;
  status.textContent = "";
  status.className = "status";
  progressWrap.hidden = true;
  downloadBtn.hidden = true;
  sendToWrap.hidden = true;
  pendingDownload = null;
  globalActions = [];
  currentSegmentActions = [];
  segments = [];
  preview.style.transform = "";
  selectedAspect = "";
  aspectPos = 0.5;
  customRect = null;
  zoomRect = null;
  cropTarget = null;
  customDragMode = null;
  cropOverlay.hidden = true;
  aspectHint.hidden = true;
  customHint.hidden = true;
  zoomHint.hidden = true;
  document.querySelectorAll(".orientation-btn").forEach((b) => b.classList.remove("active"));
  aspectGrid.querySelector('.orientation-btn[data-aspect=""]').classList.add("active");
  zoomGrid.querySelector('.orientation-btn[data-zoom="off"]').classList.add("active");
  renderSegments();

  const url = URL.createObjectURL(file);
  preview.src = url;
  videoStage.hidden = false;
  dropzone.hidden = true;
  aspectSection.hidden = false;
  zoomSection.hidden = false;
  modeSection.hidden = false;

  preview.onloadedmetadata = () => {
    mediaDuration = preview.duration;
    startTime = 0;
    endTime = mediaDuration;

    info.innerHTML = `
      <div><span>Nom du fichier</span><span>${file.name}</span></div>
      <div><span>Durée</span><span>${secondsToTimestamp(mediaDuration)}</span></div>
      <div><span>Taille</span><span>${formatBytes(file.size)}</span></div>
      <div><span>Résolution</span><span>${preview.videoWidth} x ${preview.videoHeight}</span></div>
    `;

    updateTimeline();
    playhead.hidden = false;
    updatePlayhead();
    previewBtn.disabled = false;
    addSegmentBtn.disabled = false;
    updateApplyState();
  };

  dropzone.querySelector(".dropzone-title").textContent = file.name;
}

/* ---------- Bascule de mode ---------- */

function updateApplyState() {
  const hasWork = mode === "global" ? globalActions.length > 0 || hasAspectWork() || hasZoomWork() : segments.length > 0;
  applyBtn.disabled = !selectedFile || !hasWork;
}

modeToggle.querySelectorAll(".mode-toggle-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    mode = btn.dataset.mode;
    modeToggle.querySelectorAll(".mode-toggle-btn").forEach((b) => b.classList.toggle("active", b === btn));
    globalPanel.hidden = mode !== "global";
    segmentsPanel.hidden = mode !== "segments";
    preview.style.transform = "";
    document.getElementById("aspectSectionTitle").textContent =
      mode === "global" ? "Format d'affichage (appliqué au résultat final)" : "Format d'affichage de ce morceau";
    updateApplyState();
  });
});

globalActionsEl.querySelectorAll(".orientation-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    toggleAction(globalActions, btn.dataset.action);
    btn.classList.toggle("active");
    applyPreviewTransform(globalActions);
    updateApplyState();
  });
});

segmentActionsEl.querySelectorAll(".orientation-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    toggleAction(currentSegmentActions, btn.dataset.action);
    btn.classList.toggle("active");
    applyPreviewTransform(currentSegmentActions);
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
    updateApplyState();
    return;
  }

  segmentsList.innerHTML = segments
    .map((seg, i) => {
      const tags = [...seg.actions.map((a) => ACTION_LABELS[a])];
      if (seg.aspectRatio) tags.push(ASPECT_LABELS[seg.aspectRatio]);
      if (seg.zoomRect) tags.push("Zoom");
      return `
      <div class="segment-item" data-index="${i}" title="Cliquer pour prévisualiser ce morceau">
        <span>
          <span class="segment-label">${i + 1}. ${secondsToTimestamp(seg.start)} → ${secondsToTimestamp(seg.end)}</span>
          <span class="segment-speed-tag">${tags.join(" + ")}</span>
        </span>
        <button class="segment-remove" data-index="${i}" title="Retirer">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
        </button>
      </div>`;
    })
    .join("");

  segmentsList.querySelectorAll(".segment-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".segment-remove")) return;
      const seg = segments[Number(el.dataset.index)];
      preview.currentTime = seg.start;
      applyPreviewTransform(seg.actions);
      preview.play();
      previewStopHandler = () => {
        if (preview.currentTime >= seg.end) {
          preview.pause();
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

  updateApplyState();
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
  applyPreviewTransform(currentSegmentActions);
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
  if (currentSegmentActions.length === 0 && !hasAspectWork() && !hasZoomWork()) {
    status.textContent = "Choisissez au moins une orientation, un zoom ou un format pour ce morceau.";
    status.className = "status error";
    return;
  }
  const addedEnd = endTime;
  segments.push({
    start: startTime,
    end: endTime,
    actions: [...currentSegmentActions],
    aspectRatio: selectedAspect || null,
    aspectPos: aspectPos,
    cropRect: selectedAspect === "custom" ? customRect : null,
    zoomRect: zoomRect || null,
  });
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

function setOrientationProgress(percent, label) {
  progressWrap.hidden = false;
  progressFill.style.width = `${percent}%`;
  progressLabel.textContent = label;
}

function pollOrientationProgress(jobId) {
  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/orientation/${jobId}/progress`);
        if (!res.ok) throw new Error("Tâche introuvable");
        const job = await res.json();

        if (job.status === "processing") {
          const label = job.percent >= 100
            ? "Enregistrement des métadonnées..."
            : `Traitement en cours... ${job.percent.toFixed(0)}%`;
          setOrientationProgress(job.percent, label);
        } else if (job.status === "done") {
          clearInterval(interval);
          setOrientationProgress(100, "Traitement terminé.");
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

applyBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  applyBtn.disabled = true;
  downloadBtn.hidden = true;
  sendToWrap.hidden = true;
  pendingDownload = null;
  status.className = "status";
  status.textContent = "";
  setOrientationProgress(0, "Démarrage du traitement...");

  const formData = new FormData();
  formData.append("video", selectedFile);
  formData.append("mode", mode);

  if (mode === "global") {
    formData.append("actions", JSON.stringify(globalActions));
    if (selectedAspect === "custom" && customRect) {
      formData.append("crop_rect", JSON.stringify(customRect));
    } else if (selectedAspect) {
      formData.append("aspect_ratio", selectedAspect);
      formData.append("aspect_position", aspectPos);
    }
    if (zoomRect) formData.append("zoom_rect", JSON.stringify(zoomRect));
  } else {
    formData.append(
      "segments",
      JSON.stringify(
        segments.map((s) => ({
          start: secondsToTimestamp(s.start),
          end: secondsToTimestamp(s.end),
          actions: s.actions,
          aspect_ratio: s.aspectRatio === "custom" ? null : s.aspectRatio,
          aspect_position: s.aspectPos,
          crop_rect: s.aspectRatio === "custom" ? s.cropRect : null,
          zoom_rect: s.zoomRect || null,
        }))
      )
    );
  }

  try {
    const startRes = await fetch("/api/orientation", { method: "POST", body: formData });
    if (!startRes.ok) {
      const err = await startRes.json();
      throw new Error(err.detail || "Erreur inconnue");
    }
    const { job_id } = await startRes.json();

    const job = await pollOrientationProgress(job_id);

    pendingDownload = { projectId: job.project_id, name: job.output_name };
    downloadBtn.hidden = false;
    renderSendTo("sendToWrap", job.project_id, "orientation");

    status.textContent = `Orientation modifiée avec succès (${formatBytesCommon(job.output_size)}).`;
    status.className = "status success";
  } catch (e) {
    status.textContent = `Erreur : ${e.message}`;
    status.className = "status error";
    progressWrap.hidden = true;
  } finally {
    updateApplyState();
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
