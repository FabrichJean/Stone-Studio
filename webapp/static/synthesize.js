const modeToggle = document.getElementById("synthModeToggle");
const texturePanel = document.getElementById("texturePanel");
const tonePanel = document.getElementById("tonePanel");
const visualizerPanel = document.getElementById("visualizerPanel");
const melodyPanel = document.getElementById("melodyPanel");
const synthAudioImport = document.getElementById("synthAudioImport");
const durationLabel = document.getElementById("synthDurationLabel");
const durationInput = document.getElementById("synthDuration");
const durationValue = document.getElementById("synthDurationValue");
const aspectToggle = document.getElementById("synthAspectToggle");
const synthCommonParams = document.getElementById("synthCommonParams");

const texturePresetGrid = document.getElementById("texturePresetGrid");
const tonePresetGrid = document.getElementById("tonePresetGrid");
const visualizerPresetGrid = document.getElementById("visualizerPresetGrid");
const melodyKeyGrid = document.getElementById("melodyKeyGrid");
const melodyScaleGrid = document.getElementById("melodyScaleGrid");
const melodyTimbreGrid = document.getElementById("melodyTimbreGrid");
const melodyLayersGrid = document.getElementById("melodyLayersGrid");

const toneFreqParams = document.getElementById("toneFreqParams");
const toneFreqLabel = document.getElementById("toneFreqLabel");
const toneFreq = document.getElementById("toneFreq");
const toneFreqValue = document.getElementById("toneFreqValue");
const toneBeatLabel = document.getElementById("toneBeatLabel");
const toneBeat = document.getElementById("toneBeat");
const toneBeatValue = document.getElementById("toneBeatValue");
const toneMinorLabel = document.getElementById("toneMinorLabel");
const toneMinor = document.getElementById("toneMinor");
const toneColorToggle = document.getElementById("toneColorToggle");

const dropzone = document.getElementById("dropzone");
const dropzoneImportView = document.getElementById("dropzoneImportView");
const dropzoneRecordView = document.getElementById("dropzoneRecordView");
const fileInput = document.getElementById("fileInput");
const pickProjectLink = document.getElementById("pickProjectLink");
const audioChosen = document.getElementById("synthAudioChosen");
const audioNameEl = document.getElementById("synthAudioName");
const audioClearBtn = document.getElementById("synthAudioClear");

const synthRecordLink = document.getElementById("synthRecordLink");
const synthRecordBack = document.getElementById("synthRecordBack");
const synthRecordToggle = document.getElementById("synthRecordToggle");
const synthRecordStatus = document.getElementById("synthRecordStatus");
const synthRecordTimer = document.getElementById("synthRecordTimer");

const applyBtn = document.getElementById("synthApplyBtn");
const applyLabel = document.getElementById("synthApplyLabel");
const progressWrap = document.getElementById("synthProgressWrap");
const progressFill = document.getElementById("synthProgressFill");
const progressLabel = document.getElementById("synthProgressLabel");
const statusEl = document.getElementById("synthStatus");
const sidePanel = document.getElementById("synthSidePanel");
const previewVideo = document.getElementById("synthPreviewVideo");
const previewAudio = document.getElementById("synthPreviewAudio");

let mode = "texture";
let texturePreset = texturePresetGrid.querySelector(".preset-card.active")?.dataset.preset || "life";
let tonePreset = tonePresetGrid.querySelector(".preset-card.active")?.dataset.preset || "tone";
let visualizerPreset = visualizerPresetGrid.querySelector(".preset-card.active")?.dataset.preset || "waves";
let melodyKey = melodyKeyGrid.querySelector(".preset-card.active")?.dataset.key || "C";
let melodyScale = melodyScaleGrid.querySelector(".preset-card.active")?.dataset.scale || "major";
let melodyTimbre = melodyTimbreGrid.querySelector(".preset-card.active")?.dataset.timbre || "piano";
let noiseColor = "white";
let selectedAudioFile = null;

const APPLY_LABELS = {
  texture: "Générer la texture",
  tone: "Générer le son",
  visualizer: "Générer le visualiseur",
  melody: "Générer la mélodie",
};

function bindPresetGrid(grid, onSelect) {
  grid.addEventListener("click", (e) => {
    const card = e.target.closest(".preset-card");
    if (!card) return;
    grid.querySelectorAll(".preset-card").forEach((c) => c.classList.toggle("active", c === card));
    onSelect(card.dataset.preset);
  });
}

bindPresetGrid(texturePresetGrid, (p) => { texturePreset = p; });
bindPresetGrid(visualizerPresetGrid, (p) => { visualizerPreset = p; });
bindPresetGrid(tonePresetGrid, (p) => { tonePreset = p; updateToneParamsVisibility(); });

function bindKeyGrid(grid, attr, onSelect) {
  grid.addEventListener("click", (e) => {
    const card = e.target.closest(".preset-card");
    if (!card) return;
    grid.querySelectorAll(".preset-card").forEach((c) => c.classList.toggle("active", c === card));
    onSelect(card.dataset[attr]);
  });
}
bindKeyGrid(melodyKeyGrid, "key", (v) => { melodyKey = v; });
bindKeyGrid(melodyScaleGrid, "scale", (v) => { melodyScale = v; });
bindKeyGrid(melodyTimbreGrid, "timbre", (v) => { melodyTimbre = v; });

// Couches d'accompagnement : contrairement aux autres grilles (un seul choix actif), chaque
// carte se (dés)active indépendamment — n'importe quelle combinaison, ou aucune.
melodyLayersGrid.addEventListener("click", (e) => {
  const card = e.target.closest(".preset-card");
  if (!card) return;
  card.classList.toggle("active");
});

function getMelodyLayers() {
  return Array.from(melodyLayersGrid.querySelectorAll(".preset-card.active")).map((c) => c.dataset.layer);
}

function updateToneParamsVisibility() {
  const showFreq = tonePreset === "tone" || tonePreset === "chord" || tonePreset === "binaural";
  toneFreqParams.hidden = false;
  toneFreqLabel.hidden = !showFreq;
  toneBeatLabel.hidden = tonePreset !== "binaural";
  toneMinorLabel.hidden = tonePreset !== "chord";
  toneColorToggle.hidden = tonePreset !== "noise";
}

toneFreq.addEventListener("input", () => { toneFreqValue.textContent = `${toneFreq.value} Hz`; });
toneBeat.addEventListener("input", () => { toneBeatValue.textContent = `${toneBeat.value} Hz`; });

toneColorToggle.addEventListener("click", (e) => {
  const btn = e.target.closest(".mode-toggle-btn");
  if (!btn) return;
  toneColorToggle.querySelectorAll(".mode-toggle-btn").forEach((b) => b.classList.toggle("active", b === btn));
  noiseColor = btn.dataset.color;
});

aspectToggle.addEventListener("click", (e) => {
  const btn = e.target.closest(".mode-toggle-btn");
  if (!btn) return;
  aspectToggle.querySelectorAll(".mode-toggle-btn").forEach((b) => b.classList.toggle("active", b === btn));
});

durationInput.addEventListener("input", () => { durationValue.textContent = `${durationInput.value} s`; });

const NEEDS_AUDIO_IMPORT = { visualizer: true, melody: true };

function applyModeUI(m) {
  mode = m;
  modeToggle.querySelectorAll(".mode-toggle-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));

  texturePanel.hidden = m !== "texture";
  tonePanel.hidden = m !== "tone";
  visualizerPanel.hidden = m !== "visualizer";
  melodyPanel.hidden = m !== "melody";
  synthAudioImport.hidden = !NEEDS_AUDIO_IMPORT[m];

  // Le son n'a pas de format d'image ; la durée du visualiseur/de la mélodie dépend de l'audio
  // importé — seule la texture a besoin des deux réglages en même temps.
  const aspectApplicable = m === "texture" || m === "visualizer";
  aspectToggle.parentElement.querySelector("h3").hidden = !aspectApplicable;
  aspectToggle.hidden = !aspectApplicable;
  durationLabel.hidden = m !== "texture" && m !== "tone";
  synthCommonParams.hidden = m === "melody";

  applyLabel.textContent = APPLY_LABELS[m];
  applyBtn.disabled = NEEDS_AUDIO_IMPORT[m] && !selectedAudioFile;

  statusEl.textContent = "";
  statusEl.className = "status";
}

modeToggle.addEventListener("click", (e) => {
  const btn = e.target.closest(".mode-toggle-btn");
  if (!btn) return;
  applyModeUI(btn.dataset.mode);
});

/* ===================== Visualiseur / Mélodie : import audio ou vidéo ===================== */

function handleAudioFile(file) {
  selectedAudioFile = file;
  audioNameEl.textContent = file.name;
  audioChosen.hidden = false;
  dropzone.hidden = true;
  document.getElementById("projectPicker").hidden = true;

  applyModeUI(NEEDS_AUDIO_IMPORT[mode] ? mode : "visualizer");
}

audioClearBtn.addEventListener("click", () => {
  selectedAudioFile = null;
  audioChosen.hidden = true;
  dropzone.hidden = false;
  showImportView();
  applyBtn.disabled = true;
});

dropzoneImportView.addEventListener("click", () => fileInput.click());
pickProjectLink.addEventListener("click", (e) => { e.stopPropagation(); openProjectPicker(handleAudioFile); });
dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  if (e.dataTransfer.files.length) handleAudioFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files.length) handleAudioFile(fileInput.files[0]);
});

/* ===================== Enregistrement direct au micro (ex. un vocal chanté) ===================== */

let micRecorder = null;
let micChunks = [];
let micStream = null;
let micStartedAt = 0;
let micTimerInterval = null;

function pickMicMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
}

function formatMicTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function stopMicStream() {
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  if (micTimerInterval) {
    clearInterval(micTimerInterval);
    micTimerInterval = null;
  }
}

function showRecordView() {
  dropzoneImportView.hidden = true;
  dropzoneRecordView.hidden = false;
  synthRecordStatus.textContent = "Prêt à enregistrer";
  synthRecordTimer.textContent = "00:00";
  synthRecordToggle.textContent = "Démarrer l'enregistrement";
}

function showImportView() {
  if (micRecorder && micRecorder.state === "recording") micRecorder.stop();
  stopMicStream();
  dropzoneRecordView.hidden = true;
  dropzoneImportView.hidden = false;
}

synthRecordLink.addEventListener("click", (e) => { e.stopPropagation(); showRecordView(); });
synthRecordBack.addEventListener("click", (e) => { e.stopPropagation(); showImportView(); });

synthRecordToggle.addEventListener("click", async (e) => {
  e.stopPropagation();
  if (micRecorder && micRecorder.state === "recording") {
    micRecorder.stop();
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (err) {
    synthRecordStatus.textContent = "Impossible d'accéder au micro.";
    return;
  }

  micStream = stream;
  micChunks = [];
  const mimeType = pickMicMimeType();
  micRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});

  micRecorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) micChunks.push(ev.data); };
  micRecorder.onstop = () => {
    stopMicStream();
    const blob = new Blob(micChunks, { type: mimeType || "audio/webm" });
    const ext = mimeType.includes("mp4") ? "m4a" : "webm";
    const file = new File([blob], `vocal_${Date.now()}.${ext}`, { type: blob.type });
    showImportView();
    handleAudioFile(file);
  };
  // Le micro peut être coupé/débranché en cours de route.
  stream.getAudioTracks()[0].addEventListener("ended", () => micRecorder && micRecorder.stop(), { once: true });

  micRecorder.start();
  micStartedAt = Date.now();
  synthRecordStatus.textContent = "Enregistrement en cours…";
  synthRecordToggle.textContent = "Arrêter";
  micTimerInterval = setInterval(() => {
    synthRecordTimer.textContent = formatMicTime(Date.now() - micStartedAt);
  }, 200);
});

/* ===================== Génération ===================== */

function pollJob(jobId, onDone, onError, onProgress) {
  const interval = setInterval(() => {
    fetch(`/api/synthesize/${jobId}/progress`)
      .then((r) => r.json())
      .then((job) => {
        if (job.status === "error") {
          clearInterval(interval);
          onError(job.error || "Une erreur est survenue.");
          return;
        }
        if (onProgress) onProgress(job.percent || 0);
        if (job.status === "done") {
          clearInterval(interval);
          onDone(job);
        }
      })
      .catch(() => { clearInterval(interval); onError("Connexion perdue."); });
  }, 300);
}

applyBtn.addEventListener("click", () => {
  if (NEEDS_AUDIO_IMPORT[mode] && !selectedAudioFile) return;

  applyBtn.disabled = true;
  progressWrap.hidden = false;
  progressFill.style.width = "0%";
  progressLabel.textContent = "Génération en cours…";
  statusEl.textContent = "";
  statusEl.className = "status";
  sidePanel.hidden = true;

  const aspect = aspectToggle.querySelector(".mode-toggle-btn.active")?.dataset.aspect || "landscape";
  const formData = new FormData();
  formData.append("kind", mode);
  formData.append("aspect", aspect);
  formData.append("duration", durationInput.value);

  if (mode === "texture") {
    formData.append("preset", texturePreset);
  } else if (mode === "tone") {
    formData.append("preset", tonePreset);
    formData.append("frequency", toneFreq.value);
    formData.append("beat", toneBeat.value);
    formData.append("minor", toneMinor.checked ? "true" : "false");
    formData.append("color", noiseColor);
  } else if (mode === "visualizer") {
    formData.append("preset", visualizerPreset);
    appendMediaField(formData, selectedAudioFile, "media");
  } else {
    formData.append("key", melodyKey);
    formData.append("scale", melodyScale);
    formData.append("timbre", melodyTimbre);
    formData.append("layers", getMelodyLayers().join(","));
    appendMediaField(formData, selectedAudioFile, "media");
  }

  fetch("/api/synthesize", { method: "POST", body: formData })
    .then((r) => r.json())
    .then((data) => pollJob(data.job_id, (job) => {
      progressWrap.hidden = true;
      applyBtn.disabled = false;
      statusEl.textContent = "Média généré avec succès.";
      statusEl.className = "status success";

      sidePanel.hidden = false;
      const isAudio = job.media_type === "audio";
      previewVideo.hidden = isAudio;
      previewAudio.hidden = !isAudio;
      const src = `/api/projects/${job.project_id}/download`;
      if (isAudio) { previewAudio.src = src; } else { previewVideo.src = src; }

      renderSendTo("synthSendToWrap", job.project_id, "synthesize");
    }, (err) => {
      progressWrap.hidden = true;
      applyBtn.disabled = false;
      statusEl.textContent = `Erreur : ${err}`;
      statusEl.className = "status error";
    }, (percent) => {
      progressFill.style.width = `${percent}%`;
      progressLabel.textContent = percent >= 100 ? "Finalisation…" : "Génération en cours…";
    }))
    .catch(() => {
      progressWrap.hidden = true;
      applyBtn.disabled = false;
      statusEl.textContent = "Erreur de connexion.";
      statusEl.className = "status error";
    });
});

updateToneParamsVisibility();
autoLoadFromUrl(handleAudioFile);
