/* Studio : un seul contenu chargé, une chaîne d'actions construite dessus, un export final.
   Chaque action de la chaîne est exécutée côté serveur en réutilisant directement les
   fonctions ffmpeg des outils existants (voir webapp/studio_chain.py).

   Les panneaux Découpage / Vitesse / Transformation reproduisent l'intégralité des
   fonctionnalités de leur page individuelle (piste de découpage avec poignées, mode
   "par morceaux", recadrage interactif) au lieu d'un simple formulaire réduit — ils
   pilotent directement l'aperçu principal (#studioVideo / #studioAudio). */

const STUDIO_ACTIONS = [
  { type: "trim", label: "Découpage", icon: "scissors" },
  { type: "speed", label: "Vitesse", icon: "speed" },
  { type: "orientation", label: "Transformation", icon: "orientation" },
  { type: "compress", label: "Compression", icon: "compress" },
  { type: "extract_audio", label: "Audio", icon: "headphones" },
  { type: "noise_removal", label: "Suppression bruit", icon: "noise" },
];

const ACTION_LABELS = {
  rotate_90_cw: "Rotation 90° horaire",
  rotate_90_ccw: "Rotation 90° antihoraire",
  rotate_180: "Rotation 180°",
  flip_horizontal: "Miroir horizontal",
  flip_vertical: "Miroir vertical",
};

const TRANSFORMS = {
  rotate_90_cw: "rotate(90deg)",
  rotate_90_ccw: "rotate(-90deg)",
  rotate_180: "rotate(180deg)",
  flip_horizontal: "scaleX(-1)",
  flip_vertical: "scaleY(-1)",
};

const ROTATE_90_ACTIONS = new Set(["rotate_90_cw", "rotate_90_ccw"]);

const ASPECT_NUMERIC = {
  landscape_16_9: 16 / 9,
  portrait_9_16: 9 / 16,
  square_1_1: 1,
  portrait_4_5: 4 / 5,
};

const ASPECT_LABELS = {
  landscape_16_9: "16:9 Paysage",
  portrait_9_16: "9:16 Portrait",
  square_1_1: "1:1 Carré",
  portrait_4_5: "4:5 Portrait",
  custom: "Personnalisé",
};

const LEVEL_LABELS = { light: "Léger", medium: "Moyen", strong: "Fort" };
const NOISE_LEVEL_LABELS = { light: "Légère", medium: "Moyenne", strong: "Forte" };
const RESOLUTION_LABELS = { original: "Originale", "1080p": "1080p", "720p": "720p", "480p": "480p" };
const SPEED_FACTORS = ["0.25", "0.5", "0.75", "1", "1.25", "1.5", "2", "3", "4"];

const MIN_GAP = 0.2;
const MIN_CUSTOM = 0.05;

function secondsToTimestamp(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/* Formulaires simples (un seul champ de valeurs, pas d'état interactif persistant). */
const FORMS = {
  compress: {
    html: (p) => `
      <div class="params-grid">
        <label>Niveau de compression
          <select id="f_level">
            ${Object.entries(LEVEL_LABELS).map(([k, l]) => `<option value="${k}" ${(p.level || "medium") === k ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </label>
        <label>Résolution
          <select id="f_resolution">
            ${Object.entries(RESOLUTION_LABELS).map(([k, l]) => `<option value="${k}" ${(p.resolution || "original") === k ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </label>
      </div>
      <label class="checkbox-label"><input type="checkbox" id="f_limit_size"> Limiter la taille du fichier</label>
      <div class="params-grid">
        <label>Taille max (MB)<input type="number" id="f_max_size" min="1" step="1" value="20" disabled></label>
      </div>`,
    collect: () => {
      const limit = document.getElementById("f_limit_size").checked;
      return {
        level: document.getElementById("f_level").value,
        resolution: document.getElementById("f_resolution").value,
        max_size_mb: limit ? document.getElementById("f_max_size").value.trim() || null : null,
      };
    },
    init: () => {
      const limitBox = document.getElementById("f_limit_size");
      const maxSize = document.getElementById("f_max_size");
      limitBox.addEventListener("change", () => { maxSize.disabled = !limitBox.checked; });
    },
  },
  extract_audio: {
    html: (p) => `
      <div class="studio-form-note">L'extraction retire la vidéo : place cette action en dernier dans la chaîne.</div>
      <div class="params-grid">
        <label>Format
          <select id="f_format">
            ${["mp3", "wav", "aac", "flac"].map((v) => `<option value="${v}" ${(p.format || "mp3") === v ? "selected" : ""}>${v.toUpperCase()}</option>`).join("")}
          </select>
        </label>
        <label>Bitrate
          <select id="f_bitrate">
            <option value="">Auto</option>
            ${["128k", "192k", "256k", "320k"].map((v) => `<option value="${v}" ${p.bitrate === v ? "selected" : ""}>${v}bps</option>`).join("")}
          </select>
        </label>
        <label>Canaux
          <select id="f_channels">
            <option value="">Auto</option>
            <option value="mono" ${p.channels === "mono" ? "selected" : ""}>Mono</option>
            <option value="stereo" ${p.channels === "stereo" ? "selected" : ""}>Stéréo</option>
          </select>
        </label>
        <label>Fréquence
          <select id="f_sample_rate">
            <option value="">Auto</option>
            <option value="44100" ${p.sample_rate === "44100" ? "selected" : ""}>44.1 kHz</option>
            <option value="48000" ${p.sample_rate === "48000" ? "selected" : ""}>48 kHz</option>
          </select>
        </label>
      </div>`,
    collect: () => ({
      format: document.getElementById("f_format").value,
      bitrate: document.getElementById("f_bitrate").value || null,
      channels: document.getElementById("f_channels").value || null,
      sample_rate: document.getElementById("f_sample_rate").value || null,
    }),
  },
  noise_removal: {
    html: (p) => `
      <div class="params-grid">
        <label>Intensité
          <select id="f_level">
            ${Object.entries(NOISE_LEVEL_LABELS).map(([k, l]) => `<option value="${k}" ${(p.level || "medium") === k ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </label>
      </div>
      <label class="checkbox-label"><input type="checkbox" id="f_reduce_hum" ${p.reduce_hum ? "checked" : ""}> Réduire aussi le ronflement secteur (50/60 Hz)</label>`,
    collect: () => ({
      level: document.getElementById("f_level").value,
      reduce_hum: document.getElementById("f_reduce_hum").checked,
    }),
  },
};

(function () {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const browseLink = document.getElementById("browseLink");
  const pickProjectLink = document.getElementById("pickProjectLink");
  const studioEmpty = document.getElementById("studioEmpty");
  const studioMain = document.getElementById("studioMain");
  const fileNameEl = document.getElementById("fileName");
  const fileMetaEl = document.getElementById("fileMeta");
  const newContentBtn = document.getElementById("newContentBtn");
  const exportBtn = document.getElementById("exportBtn");
  const tabsEl = document.getElementById("studioActionTabs");
  const panelEl = document.getElementById("actionPanel");
  const videoEl = document.getElementById("studioVideo");
  const audioEl = document.getElementById("studioAudio");
  const cropWrap = document.getElementById("studioCropWrap");
  const cropOverlay = document.getElementById("studioCropOverlay");
  const cropBox = document.getElementById("studioCropBox");
  const overlay = document.getElementById("previewOverlay");
  const overlayLabel = document.getElementById("previewOverlayLabel");
  const timelineTrack = document.getElementById("timelineTrack");
  const timelineRuler = document.getElementById("timelineRuler");
  const timelinePlayhead = document.getElementById("timelinePlayhead");
  const timelineScroll = document.querySelector(".studio-timeline-scroll");
  const transportStartBtn = document.getElementById("transportStart");
  const transportPlayBtn = document.getElementById("transportPlay");
  const transportEndBtn = document.getElementById("transportEnd");
  const transportTimeEl = document.getElementById("transportTime");
  const exportProgress = document.getElementById("exportProgress");
  const exportProgressFill = document.getElementById("exportProgressFill");
  const exportProgressLabel = document.getElementById("exportProgressLabel");
  const exportDone = document.getElementById("exportDone");
  const downloadBtn = document.getElementById("downloadBtn");
  const statusEl = document.getElementById("studioStatus");

  const PX_PER_SEC = 40;
  const MIN_CLIP_PX = 50;

  let timeline = []; // { id: projectId, name, mediaType, size, duration, hasFilmstrip, localUrl?, pending? }
  let activeIndex = -1;
  let selectedType = STUDIO_ACTIONS[0].type;
  let destination = "replace"; // "replace" | "add"

  function activeMediaEl() {
    const clip = timeline[activeIndex];
    return clip && clip.mediaType === "audio" ? audioEl : videoEl;
  }

  function activeDuration() {
    const clip = timeline[activeIndex];
    if (clip && clip.duration) return clip.duration;
    const media = activeMediaEl();
    return media && media.duration ? media.duration : 0;
  }

  /* ===================== Lecteur global de la timeline =====================
     Contrôle de lecture unique pour l'ensemble de la piste de montage : lit les clips
     les uns après les autres avec un curseur qui avance sur la règle de temps. Indépendant
     de l'action "active" (celle éditée dans le panneau de droite) : jouer/chercher dans la
     timeline ne modifie ni la sélection d'édition en cours ni l'état des panneaux. */

  let playingIndex = -1; // index du clip actuellement chargé dans l'aperçu pour la lecture
  let playheadTime = 0; // position globale (secondes) sur l'ensemble de la timeline
  let transportPlaying = false;
  let transportTickHandler = null;
  let transportEndedHandler = null;
  let scrubbing = false;

  function clipStartTime(index) {
    let t = 0;
    for (let i = 0; i < index; i++) t += timeline[i].duration || 3;
    return t;
  }

  function totalTimelineDuration() {
    return timeline.reduce((sum, c) => sum + (c.duration || 3), 0);
  }

  function clipIndexAtTime(t) {
    let acc = 0;
    for (let i = 0; i < timeline.length; i++) {
      const d = timeline[i].duration || 3;
      if (t < acc + d || i === timeline.length - 1) return i;
      acc += d;
    }
    return 0;
  }

  function updatePlayheadUI() {
    const total = totalTimelineDuration();
    timelinePlayhead.hidden = timeline.length === 0;
    timelinePlayhead.style.left = `${playheadTime * PX_PER_SEC}px`;
    transportTimeEl.textContent = `${secondsToTimestamp(playheadTime)} / ${secondsToTimestamp(total)}`;
  }

  function updateTransportPlayIcon() {
    transportPlayBtn.classList.toggle("playing", transportPlaying);
    transportPlayBtn.title = transportPlaying ? "Pause" : "Lecture";
  }

  // Charge le clip `idx` dans l'aperçu pour la lecture (bascule vidéo/audio si besoin),
  // sans toucher à `activeIndex` ni au panneau d'édition.
  function loadClipForPlayback(idx) {
    const clip = timeline[idx];
    if (!clip || !clip.id) return null;
    const media = clip.mediaType === "audio" ? audioEl : videoEl;
    const other = clip.mediaType === "audio" ? videoEl : audioEl;
    if (playingIndex !== idx) {
      other.pause();
      media.src = clip.localUrl || `/api/projects/${clip.id}/download`;
      media.hidden = false;
      other.hidden = true;
      playingIndex = idx;
    }
    return media;
  }

  function detachTransportTracking() {
    [videoEl, audioEl].forEach((m) => {
      if (transportTickHandler) m.removeEventListener("timeupdate", transportTickHandler);
      if (transportEndedHandler) m.removeEventListener("ended", transportEndedHandler);
    });
  }

  function attachTransportTracking(media) {
    detachTransportTracking();
    if (!media) return;
    transportTickHandler = () => {
      playheadTime = clipStartTime(playingIndex) + media.currentTime;
      updatePlayheadUI();
    };
    transportEndedHandler = () => advanceTransport();
    media.addEventListener("timeupdate", transportTickHandler);
    media.addEventListener("ended", transportEndedHandler);
  }

  function advanceTransport() {
    if (playingIndex + 1 >= timeline.length) {
      pauseTransport();
      seekTo(totalTimelineDuration());
      return;
    }
    const media = loadClipForPlayback(playingIndex + 1);
    if (!media) { pauseTransport(); return; }
    const start = () => { media.currentTime = 0; media.play(); };
    if (media.readyState >= 1) start(); else media.addEventListener("loadedmetadata", start, { once: true });
    attachTransportTracking(media);
  }

  function seekTo(time) {
    if (timeline.length === 0) return;
    const total = totalTimelineDuration();
    time = Math.max(0, Math.min(time, total));
    const idx = clipIndexAtTime(time);
    const media = loadClipForPlayback(idx);
    if (!media) return;
    const local = time - clipStartTime(idx);
    const applySeek = () => { media.currentTime = local; };
    if (media.readyState >= 1) applySeek(); else media.addEventListener("loadedmetadata", applySeek, { once: true });
    playheadTime = time;
    updatePlayheadUI();
  }

  function playTransport() {
    if (timeline.length === 0 || timeline.some((c) => !c.id)) return;
    if (playheadTime >= totalTimelineDuration() - 0.05) seekTo(0);
    transportPlaying = true;
    updateTransportPlayIcon();
    const idx = clipIndexAtTime(playheadTime);
    const media = loadClipForPlayback(idx);
    if (!media) { transportPlaying = false; updateTransportPlayIcon(); return; }
    const local = playheadTime - clipStartTime(idx);
    const start = () => { media.currentTime = local; media.play(); };
    if (media.readyState >= 1) start(); else media.addEventListener("loadedmetadata", start, { once: true });
    attachTransportTracking(media);
  }

  function pauseTransport() {
    transportPlaying = false;
    updateTransportPlayIcon();
    detachTransportTracking();
    if (playingIndex >= 0) {
      const clip = timeline[playingIndex];
      const media = clip && clip.mediaType === "audio" ? audioEl : videoEl;
      media.pause();
    }
  }

  function toggleTransportPlay() {
    if (transportPlaying) pauseTransport(); else playTransport();
  dropzone.addEventListener("click", () => fileInput.click());
  browseLink.addEventListener("click", (e) => { e.stopPropagation(); fileInput.click(); });
  pickProjectLink.addEventListener("click", (e) => { e.stopPropagation(); openProjectPicker(handleFile); });
  dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) handleFile(fileInput.files[0]);
  });

  newContentBtn.addEventListener("click", resetStudio);
  exportBtn.addEventListener("click", runExport);

  function resetStudio() {
    timeline = [];
    activeIndex = -1;
    destination = "replace";
    selectedType = STUDIO_ACTIONS[0].type;
    videoEl.src = ""; audioEl.src = "";
    exportDone.hidden = true;
    exportProgress.hidden = true;
    statusEl.textContent = "";
    studioMain.hidden = true;
    studioEmpty.hidden = false;
    dropzone.hidden = false;
    document.getElementById("projectPicker").hidden = true;
    dropzone.querySelector(".dropzone-title").textContent = "Glissez votre média ici";
  }

  function handleFile(file) {
    statusEl.textContent = "";
    exportDone.hidden = true;
    exportProgress.hidden = true;

    const mediaType = file.type.startsWith("audio/") ? "audio" : "video";
    const localUrl = URL.createObjectURL(file);

    fileNameEl.textContent = file.name;
    fileMetaEl.textContent = formatBytesCommon(file.size);

    studioEmpty.hidden = true;
    studioMain.hidden = false;

    timeline = [{ id: null, name: file.name, mediaType, size: file.size, duration: null, hasFilmstrip: false, localUrl }];
    activeIndex = 0;
    setActiveClip(0);
    selectAction(selectedType);
    renderTimeline();

    const mediaEl = mediaType === "audio" ? audioEl : videoEl;
    mediaEl.addEventListener("loadedmetadata", function onMeta() {
      mediaEl.removeEventListener("loadedmetadata", onMeta);
      if (timeline[0] && timeline[0].duration === null) {
        timeline[0].duration = mediaEl.duration;
        renderTimeline();
      }
    });

    const formData = new FormData();
    formData.append("file", file);
    fetch("/api/studio/upload", { method: "POST", body: formData })
      .then((r) => r.json())
      .then((record) => {
        if (!timeline[0]) return;
        timeline[0].id = record.id;
        timeline[0].duration = record.duration;
        timeline[0].hasFilmstrip = record.has_filmstrip;
        timeline[0].mediaType = record.media_type;
        renderTimeline();
      })
      .catch(() => { statusEl.textContent = "Erreur lors de l'import du fichier."; statusEl.className = "status error"; });
  }

  function setActiveClip(index) {
    activeIndex = index;
    const clip = timeline[index];
    if (!clip) return;
    const src = clip.localUrl || `/api/projects/${clip.id}/download`;
    if (clip.mediaType === "audio") {
      audioEl.src = src; audioEl.hidden = false;
      videoEl.hidden = true; videoEl.src = "";
    } else {
      videoEl.src = src; videoEl.hidden = false;
      audioEl.hidden = true; audioEl.src = "";
    }
    renderTimeline();
  }

  function clipWidth(clip) {
    return Math.max(MIN_CLIP_PX, Math.round((clip.duration || 3) * PX_PER_SEC));
  }

  function renderTimeline() {
    const totalDuration = timeline.reduce((sum, c) => sum + (c.duration || 3), 0);
    const totalWidth = Math.max(timeline.reduce((sum, c) => sum + clipWidth(c), 0), 1);

    timelineRuler.style.width = `${totalWidth}px`;
    timelineRuler.innerHTML = "";
    const secondsCount = Math.ceil(totalDuration) + 1;
    for (let s = 0; s <= secondsCount; s++) {
      const tick = document.createElement("div");
      tick.className = "studio-ruler-tick";
      tick.style.left = `${s * PX_PER_SEC}px`;
      tick.innerHTML = `<span>${formatDurationCommon(s)}</span>`;
      timelineRuler.appendChild(tick);
    }

    timelineTrack.style.width = `${totalWidth}px`;
    timelineTrack.innerHTML = "";
    timeline.forEach((clip, i) => {
      const block = document.createElement("div");
      if (clip.pending) {
        block.className = "studio-clip studio-clip-pending";
        block.style.width = `${clipWidth(clip)}px`;
        block.innerHTML = `<div class="spinner"></div>`;
        timelineTrack.appendChild(block);
        return;
      }

      const isAudio = clip.mediaType === "audio";
      block.className = "studio-clip" + (i === activeIndex ? " active" : "") + (isAudio ? " studio-clip-audio" : "");
      block.style.width = `${clipWidth(clip)}px`;
      if (!isAudio && clip.hasFilmstrip) {
        block.style.backgroundImage = `url(/api/projects/${clip.id}/filmstrip)`;
      }
      block.innerHTML = `
        <span class="studio-clip-label">${clip.name}</span>
        <button type="button" class="studio-clip-remove" title="Retirer">✕</button>`;
      block.addEventListener("click", (e) => {
        if (e.target.closest(".studio-clip-remove")) return;
        if (!clip.id) return;
        setActiveClip(i);
      });
      block.querySelector(".studio-clip-remove").addEventListener("click", () => removeClip(i));
      timelineTrack.appendChild(block);
    });
    exportBtn.disabled = timeline.length === 0 || timeline.some((c) => c.pending);
  }

  function removeClip(index) {
    timeline.splice(index, 1);
    if (timeline.length === 0) { resetStudio(); return; }
    setActiveClip(Math.min(activeIndex, timeline.length - 1));
  }

  function renderTabs() {
    tabsEl.innerHTML = STUDIO_ACTIONS.map((a) => `
      <button type="button" class="studio-action-tab${a.type === selectedType ? " active" : ""}" data-type="${a.type}">
        <span class="icon">${ICONS[a.icon] || ""}</span><span>${a.label}</span>
      </button>`).join("");
    tabsEl.querySelectorAll("[data-type]").forEach((btn) => {
      btn.addEventListener("click", () => selectAction(btn.dataset.type));
    });
  }

  function selectAction(type) {
    selectedType = type;
    renderTabs();
    const form = FORMS[type];
    const label = destination === "add" ? "Ajouter à la timeline" : "Remplacer le contenu actif";
    panelEl.innerHTML = `
      <h3>${STUDIO_ACTIONS.find((a) => a.type === type).label}</h3>
      <div class="studio-destination-toggle">
        <button type="button" class="studio-destination-btn${destination === "replace" ? " active" : ""}" data-dest="replace">Remplacer le contenu actif</button>
        <button type="button" class="studio-destination-btn${destination === "add" ? " active" : ""}" data-dest="add">Ajouter à la timeline</button>
      </div>
      ${form.html({})}
      <div class="studio-panel-actions">
        <button type="button" class="btn-primary" id="applyActionBtn">${label}</button>
      </div>`;
    panelEl.querySelectorAll("[data-dest]").forEach((btn) => {
      btn.addEventListener("click", () => { destination = btn.dataset.dest; selectAction(type); });
    });
    document.getElementById("applyActionBtn").addEventListener("click", applyAction);
  }

  function applyAction() {
    if (activeIndex < 0) return;
    const activeClip = timeline[activeIndex];
    if (!activeClip.id) { statusEl.textContent = "Le fichier est encore en cours d'import…"; statusEl.className = "status"; return; }

    const params = FORMS[selectedType].collect();
    const chainPayload = [{ type: selectedType, enabled: true, params }];
    const formData = new FormData();
    formData.append("project_id", activeClip.id);
    formData.append("chain", JSON.stringify(chainPayload));

    if (destination === "add") {
      // Non bloquant : un placeholder apparaît immédiatement dans la timeline, le clip
      // réel le remplace une fois le traitement terminé en arrière-plan.
      const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      timeline.push({ tempId, pending: true, mediaType: null, duration: activeClip.duration });
      renderTimeline();

      fetch("/api/studio/render", { method: "POST", body: formData })
        .then((r) => r.json())
        .then((data) => pollJob(data.job_id, (job) => {
          const idx = timeline.findIndex((c) => c.tempId === tempId);
          if (idx === -1) return;
          timeline[idx] = {
            id: job.project_id, name: job.output_name, mediaType: job.media_type,
            size: job.output_size, duration: job.duration, hasFilmstrip: job.has_filmstrip,
          };
          renderTimeline();
        }, (err) => {
          const idx = timeline.findIndex((c) => c.tempId === tempId);
          if (idx !== -1) { timeline.splice(idx, 1); renderTimeline(); }
          statusEl.textContent = err;
          statusEl.className = "status error";
        }))
        .catch(() => {
          const idx = timeline.findIndex((c) => c.tempId === tempId);
          if (idx !== -1) { timeline.splice(idx, 1); renderTimeline(); }
        });
      return;
    }

    // "Remplacer" affecte directement le contenu actif : on bloque avec un indicateur
    // de progression le temps du traitement, puisqu'il n'y a rien d'autre à prévisualiser.
    overlay.hidden = false;
    overlayLabel.textContent = "Traitement en cours…";

    fetch("/api/studio/render", { method: "POST", body: formData })
      .then((r) => r.json())
      .then((data) => pollJob(data.job_id, (job) => {
        overlay.hidden = true;
        timeline[activeIndex] = {
          id: job.project_id, name: job.output_name, mediaType: job.media_type,
          size: job.output_size, duration: job.duration, hasFilmstrip: job.has_filmstrip,
        };
        renderTimeline();
        setActiveClip(activeIndex);
      }, (err) => {
        overlay.hidden = true;
        statusEl.textContent = err;
        statusEl.className = "status error";
      }))
      .catch(() => { overlay.hidden = true; });
  }

  function runExport() {
    if (timeline.length === 0 || timeline.some((c) => !c.id)) return;
    exportBtn.disabled = true;
    exportDone.hidden = true;
    exportProgress.hidden = false;
    exportProgressFill.style.width = "0%";
    exportProgressLabel.textContent = "Assemblage de la timeline…";

    const formData = new FormData();
    formData.append("clip_ids", JSON.stringify(timeline.map((c) => c.id)));

    fetch("/api/studio/export-timeline", { method: "POST", body: formData })
      .then((r) => r.json())
      .then((data) => pollJob(data.job_id, (job) => {
        exportProgress.hidden = true;
        exportDone.hidden = false;
        exportBtn.disabled = false;
        downloadBtn.onclick = () => {
          const a = document.createElement("a");
          a.href = `/api/projects/${job.project_id}/download`;
          a.download = job.output_name;
          document.body.appendChild(a);
          a.click();
          a.remove();
        };
        renderSendTo("sendToWrap", job.project_id, "studio_chain");
      }, (err) => {
        exportProgress.hidden = true;
        exportBtn.disabled = false;
        statusEl.textContent = err;
        statusEl.className = "status error";
      }, (percent, label) => {
        exportProgressFill.style.width = `${percent}%`;
        exportProgressLabel.textContent = label;
      }))
      .catch(() => { exportProgress.hidden = true; exportBtn.disabled = false; });
  }

  function pollJob(jobId, onDone, onError, onProgress) {
    const interval = setInterval(() => {
      fetch(`/api/studio/render/${jobId}/progress`)
        .then((r) => r.json())
        .then((job) => {
          if (job.status === "error") {
            clearInterval(interval);
            onError(job.error || "Une erreur est survenue.");
            return;
          }
          if (onProgress) {
            const label = job.percent >= 100 ? "Finalisation…" : "Traitement en cours…";
            onProgress(job.percent || 0, label);
          }
          if (job.status === "done") {
            clearInterval(interval);
            onDone(job);
          }
        })
        .catch(() => { clearInterval(interval); onError("Connexion perdue."); });
    }, 300);
  }

  renderTabs();
  selectAction(selectedType);
  renderTimeline();
})();
