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
  }

  transportPlayBtn.addEventListener("click", toggleTransportPlay);
  transportStartBtn.addEventListener("click", () => { pauseTransport(); seekTo(0); });
  transportEndBtn.addEventListener("click", () => { pauseTransport(); seekTo(totalTimelineDuration()); });

  function scrubToClientX(clientX) {
    const rect = timelineTrack.getBoundingClientRect();
    const t = (clientX - rect.left) / PX_PER_SEC;
    seekTo(t);
  }

  timelineScroll.addEventListener("pointerdown", (e) => {
    if (timeline.length === 0 || e.target.closest(".studio-clip-remove")) return;
    scrubbing = true;
    if (transportPlaying) pauseTransport();
    scrubToClientX(e.clientX);
  });
  window.addEventListener("pointermove", (e) => { if (scrubbing) scrubToClientX(e.clientX); });
  window.addEventListener("pointerup", () => { scrubbing = false; });

  /* ===================== Upload / dropzone / import ===================== */

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
    if (transportPlaying) pauseTransport();
    timeline = [];
    activeIndex = -1;
    playingIndex = -1;
    playheadTime = 0;
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
    renderTimeline();

    // Le panneau actif a pu être construit avec une durée de 0 (métadonnées pas encore
    // chargées) : on le reconstruit dès que la vraie durée est connue.
    const refreshPanelIfCustom = () => { if (CUSTOM_PANELS[selectedType] && activeIndex === 0) selectAction(selectedType); };

    const mediaEl = mediaType === "audio" ? audioEl : videoEl;
    mediaEl.addEventListener("loadedmetadata", function onMeta() {
      mediaEl.removeEventListener("loadedmetadata", onMeta);
      if (timeline[0] && timeline[0].duration === null) {
        timeline[0].duration = mediaEl.duration;
        renderTimeline();
        refreshPanelIfCustom();
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
    if (transportPlaying) pauseTransport();
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
    videoEl.style.transform = "";
    playingIndex = index;
    playheadTime = clipStartTime(index);
    renderTimeline();
    selectAction(selectedType);
  }

  /* ===================== Timeline (piste de montage) ===================== */

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
    updatePlayheadUI();
  }

  function removeClip(index) {
    timeline.splice(index, 1);
    if (timeline.length === 0) { resetStudio(); return; }
    setActiveClip(Math.min(activeIndex, timeline.length - 1));
  }

  /* ===================== Piste de découpage partagée (Découpage / Vitesse / Transformation) =====================
     Un même moteur de piste (poignées de début/fin, tête de lecture, liste de morceaux) est
     réutilisé par les trois outils qui en ont besoin — seul le contenu de chaque "morceau"
     diffère (facteur de vitesse, actions de rotation, etc.). */

  let track = null; // { duration, start, end, segments: [...] , dragging }
  let trackPointerMoveHandler = null;
  let trackPointerUpHandler = null;
  let trackPlayheadHandler = null;
  let previewStopHandler = null;

  function initTrack(container) {
    const duration = activeDuration();
    track = { duration, start: 0, end: duration, segments: [], dragging: null };

    const els = {
      track: container.querySelector(".trim-track"),
      range: container.querySelector(".trim-range"),
      markers: container.querySelector(".segment-markers"),
      playhead: container.querySelector(".playhead"),
      handleStart: container.querySelector(".trim-handle-start"),
      handleEnd: container.querySelector(".trim-handle-end"),
      startLabel: container.querySelector(".trim-start-label"),
      endLabel: container.querySelector(".trim-end-label"),
      durationLabel: container.querySelector(".trim-duration-label"),
    };

    function positionToTime(clientX) {
      const rect = els.track.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return ratio * track.duration;
    }

    if (trackPointerMoveHandler) window.removeEventListener("pointermove", trackPointerMoveHandler);
    if (trackPointerUpHandler) window.removeEventListener("pointerup", trackPointerUpHandler);

    trackPointerMoveHandler = (e) => {
      if (!track || !track.dragging || !track.duration) return;
      const t = positionToTime(e.clientX);
      if (track.dragging === "start") {
        track.start = Math.max(0, Math.min(t, track.end - MIN_GAP));
      } else {
        track.end = Math.min(track.duration, Math.max(t, track.start + MIN_GAP));
      }
      activeMediaEl().currentTime = track.dragging === "start" ? track.start : track.end;
      updateTrackUI(els);
    };
    trackPointerUpHandler = () => { if (track) track.dragging = null; };
    window.addEventListener("pointermove", trackPointerMoveHandler);
    window.addEventListener("pointerup", trackPointerUpHandler);

    els.handleStart.addEventListener("pointerdown", (e) => { e.preventDefault(); track.dragging = "start"; });
    els.handleEnd.addEventListener("pointerdown", (e) => { e.preventDefault(); track.dragging = "end"; });
    els.track.addEventListener("pointerdown", (e) => {
      if (e.target === els.handleStart || e.target === els.handleEnd || !track.duration) return;
      const t = positionToTime(e.clientX);
      if (Math.abs(t - track.start) <= Math.abs(t - track.end)) {
        track.start = Math.min(t, track.end - MIN_GAP);
        track.dragging = "start";
      } else {
        track.end = Math.max(t, track.start + MIN_GAP);
        track.dragging = "end";
      }
      activeMediaEl().currentTime = track.dragging === "start" ? track.start : track.end;
      updateTrackUI(els);
    });

    if (trackPlayheadHandler) {
      videoEl.removeEventListener("timeupdate", trackPlayheadHandler);
      audioEl.removeEventListener("timeupdate", trackPlayheadHandler);
    }
    trackPlayheadHandler = () => {
      if (!track || !track.duration || !els.playhead.isConnected) return;
      const media = activeMediaEl();
      els.playhead.style.left = `${(media.currentTime / track.duration) * 100}%`;
    };
    videoEl.addEventListener("timeupdate", trackPlayheadHandler);
    audioEl.addEventListener("timeupdate", trackPlayheadHandler);

    updateTrackUI(els);
    return els;
  }

  function updateTrackUI(els) {
    if (!track.duration) return;
    const startPct = (track.start / track.duration) * 100;
    const endPct = (track.end / track.duration) * 100;
    els.handleStart.style.left = `${startPct}%`;
    els.handleEnd.style.left = `${endPct}%`;
    els.range.style.left = `${startPct}%`;
    els.range.style.right = `${100 - endPct}%`;
    els.startLabel.textContent = secondsToTimestamp(track.start);
    els.endLabel.textContent = secondsToTimestamp(track.end);
    els.durationLabel.textContent = `durée : ${secondsToTimestamp(track.end - track.start)}`;
    renderTrackMarkers(els);
  }

  function renderTrackMarkers(els) {
    els.markers.innerHTML = "";
    track.segments.forEach((seg) => {
      const marker = document.createElement("div");
      marker.className = "segment-marker";
      marker.style.left = `${(seg.start / track.duration) * 100}%`;
      marker.style.width = `${((seg.end - seg.start) / track.duration) * 100}%`;
      els.markers.appendChild(marker);
    });
  }

  function playRanges(media, ranges, onSegment) {
    if (!ranges.length) return;
    if (previewStopHandler) { media.removeEventListener("timeupdate", previewStopHandler); previewStopHandler = null; }
    let i = 0;
    media.currentTime = ranges[0].start;
    if (onSegment) onSegment(ranges[0]);
    media.play();
    previewStopHandler = () => {
      if (media.currentTime < ranges[i].end) return;
      i += 1;
      if (i >= ranges.length) {
        media.pause();
        media.removeEventListener("timeupdate", previewStopHandler);
        previewStopHandler = null;
        return;
      }
      media.currentTime = ranges[i].start;
      if (onSegment) onSegment(ranges[i]);
    };
    media.addEventListener("timeupdate", previewStopHandler);
  }

  function trimTrackHtml() {
    return `
      <div class="trim-times">
        <span class="trim-start-label">00:00:00</span>
        <span class="trim-duration-label trim-duration"></span>
        <span class="trim-end-label">00:00:00</span>
      </div>
      <div class="trim-track">
        <div class="trim-range"></div>
        <div class="segment-markers"></div>
        <div class="playhead"></div>
        <div class="trim-handle trim-handle-start" tabindex="0"></div>
        <div class="trim-handle trim-handle-end" tabindex="0"></div>
      </div>`;
  }

  /* ===================== Panneau Découpage ===================== */

  const TrimPanel = {
    render(container) {
      container.innerHTML = `
        ${trimTrackHtml()}
        <div class="btn-row">
          <button type="button" class="btn-secondary" id="trimPreviewBtn">Prévisualiser</button>
          <button type="button" class="btn-secondary" id="trimAddSegmentBtn">Ajouter ce morceau</button>
        </div>
        <div class="segments-list" id="trimSegmentsList"></div>`;

      const trackEls = initTrack(container);
      renderTrimSegments();

      document.getElementById("trimPreviewBtn").addEventListener("click", () => {
        playRanges(activeMediaEl(), track.segments.length > 0 ? track.segments : [{ start: track.start, end: track.end }]);
      });

      document.getElementById("trimAddSegmentBtn").addEventListener("click", () => {
        const addedEnd = track.end;
        track.segments.push({ start: track.start, end: track.end });
        track.segments.sort((a, b) => a.start - b.start);
        renderTrimSegments();
        updateTrackUI(trackEls);
        if (addedEnd < track.duration - MIN_GAP) {
          track.start = addedEnd;
          track.end = track.duration;
          activeMediaEl().currentTime = track.start;
          updateTrackUI(trackEls);
        }
      });

      function renderTrimSegments() {
        const list = document.getElementById("trimSegmentsList");
        if (!list) return;
        if (track.segments.length === 0) {
          list.innerHTML = `<div class="segments-empty">Aucun morceau ajouté — l'action utilisera la sélection en cours.</div>`;
          return;
        }
        list.innerHTML = track.segments.map((seg, i) => `
          <div class="segment-item" data-index="${i}" title="Cliquer pour prévisualiser ce morceau">
            <span>
              <span class="segment-label">${i + 1}. ${secondsToTimestamp(seg.start)} → ${secondsToTimestamp(seg.end)}</span>
              <span class="segment-duration">(${secondsToTimestamp(seg.end - seg.start)})</span>
            </span>
            <button type="button" class="segment-remove" data-index="${i}" title="Retirer">✕</button>
          </div>`).join("");
        list.querySelectorAll(".segment-item").forEach((el) => {
          el.addEventListener("click", (e) => {
            if (e.target.closest(".segment-remove")) return;
            playRanges(activeMediaEl(), [track.segments[Number(el.dataset.index)]]);
          });
        });
        list.querySelectorAll(".segment-remove").forEach((btn) => {
          btn.addEventListener("click", () => {
            track.segments.splice(Number(btn.dataset.index), 1);
            renderTrimSegments();
            renderTrackMarkers(trackEls);
          });
        });
      }
    },
    collect() {
      if (track.segments.length > 0) {
        return { mode: "segments", segments: track.segments.map((s) => ({ start: secondsToTimestamp(s.start), end: secondsToTimestamp(s.end) })) };
      }
      return { mode: "single", start: secondsToTimestamp(track.start), end: secondsToTimestamp(track.end) };
    },
  };

  /* ===================== Panneau Vitesse ===================== */

  function speedFactorSelectHtml(id, selected) {
    return `<select id="${id}">
      ${SPEED_FACTORS.map((v) => `<option value="${v}" ${selected === v ? "selected" : ""}>${v}x${v === "1" ? " (normal)" : ""}</option>`).join("")}
    </select>`;
  }

  const SpeedPanel = {
    render(container) {
      let mode = "global";
      container.innerHTML = `
        <div class="mode-toggle">
          <button type="button" class="mode-toggle-btn active" data-mode="global">Vitesse globale</button>
          <button type="button" class="mode-toggle-btn" data-mode="segments">Par morceau</button>
        </div>
        <div class="speed-panel" id="speedGlobalPanel">
          <label class="speed-label">Vitesse du fichier entier ${speedFactorSelectHtml("speedGlobalFactor", "1")}</label>
        </div>
        <div class="speed-panel" id="speedSegmentsPanel" hidden>
          ${trimTrackHtml()}
          <label class="speed-label">Vitesse de ce morceau ${speedFactorSelectHtml("speedSegmentFactor", "1.5")}</label>
          <div class="btn-row">
            <button type="button" class="btn-secondary" id="speedPreviewBtn">Prévisualiser</button>
            <button type="button" class="btn-secondary" id="speedAddSegmentBtn">Ajouter ce morceau</button>
          </div>
          <div class="segments-list" id="speedSegmentsList"></div>
        </div>`;

      const segmentsPanel = document.getElementById("speedSegmentsPanel");
      const globalPanel = document.getElementById("speedGlobalPanel");
      let trackEls = null;

      container.querySelectorAll(".mode-toggle-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          mode = btn.dataset.mode;
          container.querySelectorAll(".mode-toggle-btn").forEach((b) => b.classList.toggle("active", b === btn));
          globalPanel.hidden = mode !== "global";
          segmentsPanel.hidden = mode !== "segments";
          activeMediaEl().playbackRate = 1;
          if (mode === "segments" && !trackEls) {
            trackEls = initTrack(segmentsPanel);
            renderSpeedSegments();
          }
        });
      });

      function renderSpeedSegments() {
        const list = document.getElementById("speedSegmentsList");
        if (!list) return;
        if (track.segments.length === 0) {
          list.innerHTML = `<div class="segments-empty">Aucun morceau ajouté.</div>`;
          return;
        }
        list.innerHTML = track.segments.map((seg, i) => `
          <div class="segment-item" data-index="${i}" title="Cliquer pour prévisualiser ce morceau">
            <span>
              <span class="segment-label">${i + 1}. ${secondsToTimestamp(seg.start)} → ${secondsToTimestamp(seg.end)}</span>
              <span class="segment-duration">(${secondsToTimestamp(seg.end - seg.start)})</span>
              <span class="segment-speed-tag">${seg.factor}x</span>
            </span>
            <button type="button" class="segment-remove" data-index="${i}" title="Retirer">✕</button>
          </div>`).join("");
        list.querySelectorAll(".segment-item").forEach((el) => {
          el.addEventListener("click", (e) => {
            if (e.target.closest(".segment-remove")) return;
            const seg = track.segments[Number(el.dataset.index)];
            const media = activeMediaEl();
            playRanges(media, [seg], () => { media.playbackRate = seg.factor; });
          });
        });
        list.querySelectorAll(".segment-remove").forEach((btn) => {
          btn.addEventListener("click", () => {
            track.segments.splice(Number(btn.dataset.index), 1);
            renderSpeedSegments();
            if (trackEls) renderTrackMarkers(trackEls);
          });
        });
      }

      document.getElementById("speedPreviewBtn")?.addEventListener("click", () => {
        activeMediaEl().playbackRate = 1;
        playRanges(activeMediaEl(), [{ start: track.start, end: track.end }]);
      });

      document.getElementById("speedAddSegmentBtn")?.addEventListener("click", () => {
        const factor = parseFloat(document.getElementById("speedSegmentFactor").value);
        const addedEnd = track.end;
        track.segments.push({ start: track.start, end: track.end, factor });
        track.segments.sort((a, b) => a.start - b.start);
        renderSpeedSegments();
        updateTrackUI(trackEls);
        if (addedEnd < track.duration - MIN_GAP) {
          track.start = addedEnd;
          track.end = track.duration;
          activeMediaEl().currentTime = track.start;
          updateTrackUI(trackEls);
        }
      });

      // Initialise toujours un track (même en mode global) pour disposer de la durée courante.
      track = { duration: activeDuration(), start: 0, end: activeDuration(), segments: [], dragging: null };
      this._getMode = () => mode;
    },
    collect() {
      const mode = this._getMode();
      activeMediaEl().playbackRate = 1;
      if (mode === "segments") {
        if (!track.segments.length) throw new Error("Ajoutez au moins un morceau.");
        return { mode: "segments", segments: track.segments.map((s) => ({ start: secondsToTimestamp(s.start), end: secondsToTimestamp(s.end), factor: s.factor })) };
      }
      return { mode: "global", factor: document.getElementById("speedGlobalFactor").value };
    },
  };

  /* ===================== Panneau Transformation ===================== */

  const OrientationPanel = {
    render(container) {
      let mode = "global";
      let selectedAspect = "";
      let aspectPos = 0.5;
      let cropAxis = null;
      let draggingCrop = false;
      let customRect = null;
      let customDragMode = null;
      let customHandle = null;
      let customDragStart = null;
      let customRectStart = null;
      let globalActions = [];
      let currentSegmentActions = [];
      let trackEls = null;

      const aspectButtons = () => `
        <div class="orientation-grid">
          <button type="button" class="orientation-btn active" data-aspect="">
            <svg width="20" height="20" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3" y="4.5" width="16" height="13" rx="1.5" stroke-dasharray="2.5 2"/></svg>
            <span>Original</span>
          </button>
          <button type="button" class="orientation-btn" data-aspect="landscape_16_9">
            <svg width="20" height="20" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="6.4" width="19" height="9.2" rx="1.5"/></svg>
            <span>16:9</span>
          </button>
          <button type="button" class="orientation-btn" data-aspect="portrait_9_16">
            <svg width="20" height="20" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="6.4" y="1.5" width="9.2" height="19" rx="1.5"/></svg>
            <span>9:16</span>
          </button>
          <button type="button" class="orientation-btn" data-aspect="square_1_1">
            <svg width="20" height="20" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3" y="3" width="16" height="16" rx="1.5"/></svg>
            <span>1:1</span>
          </button>
          <button type="button" class="orientation-btn" data-aspect="portrait_4_5">
            <svg width="20" height="20" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="5" y="2" width="12" height="18" rx="1.5"/></svg>
            <span>4:5</span>
          </button>
          <button type="button" class="orientation-btn" data-aspect="custom">
            <svg width="20" height="20" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3" y="3" width="16" height="16" rx="1.5" stroke-dasharray="2.5 2"/><path d="M13.5 8.5l-5 5m0-4v4h4" stroke-dasharray="none"/></svg>
            <span>Perso</span>
          </button>
        </div>`;

      const actionButtonsInner = `
          <button type="button" class="orientation-btn" data-action="rotate_90_ccw">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3.2 5.8A5 5 0 1 1 3 8"/><path d="M3.2 2.5v3.3h3.3"/></svg>
            <span>90° antihoraire</span>
          </button>
          <button type="button" class="orientation-btn" data-action="rotate_90_cw">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12.8 5.8A5 5 0 1 0 13 8"/><path d="M12.8 2.5v3.3h-3.3"/></svg>
            <span>90° horaire</span>
          </button>
          <button type="button" class="orientation-btn" data-action="rotate_180">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h12"/><path d="M5 5L2 8l3 3"/><path d="M11 5l3 3-3 3"/></svg>
            <span>180°</span>
          </button>
          <button type="button" class="orientation-btn" data-action="flip_horizontal">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5v13"/><path d="M4.5 5L2 8l2.5 3"/><path d="M11.5 5L14 8l-2.5 3"/></svg>
            <span>Miroir H</span>
          </button>
          <button type="button" class="orientation-btn" data-action="flip_vertical">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8h13"/><path d="M5 4.5L8 2l3 2.5"/><path d="M5 11.5L8 14l3-2.5"/></svg>
            <span>Miroir V</span>
          </button>`;

      container.innerHTML = `
        <h4 id="aspectSectionTitle" class="studio-subheading">Format d'affichage (résultat final)</h4>
        ${aspectButtons()}
        <p class="studio-form-note" id="aspectHint" hidden>Glissez le cadre sur l'aperçu pour choisir la zone conservée.</p>
        <p class="studio-form-note" id="customHint" hidden>Dessinez un cadre sur l'aperçu, puis ajustez-le par les coins ou en le déplaçant.</p>

        <div class="mode-toggle" style="margin-top:16px;">
          <button type="button" class="mode-toggle-btn active" data-mode="global">Orientation globale</button>
          <button type="button" class="mode-toggle-btn" data-mode="segments">Par morceau</button>
        </div>

        <div class="speed-panel" id="orientGlobalPanel">
          <div class="orientation-grid">${actionButtonsInner}</div>
        </div>

        <div class="speed-panel" id="orientSegmentsPanel" hidden>
          ${trimTrackHtml()}
          <div class="orientation-grid" id="orientSegmentActions">${actionButtonsInner}</div>
          <div class="btn-row">
            <button type="button" class="btn-secondary" id="orientPreviewBtn">Prévisualiser</button>
            <button type="button" class="btn-secondary" id="orientAddSegmentBtn">Ajouter ce morceau</button>
          </div>
          <div class="segments-list" id="orientSegmentsList"></div>
        </div>`;

      const globalPanel = document.getElementById("orientGlobalPanel");
      const segmentsPanel = document.getElementById("orientSegmentsPanel");
      const aspectHint = document.getElementById("aspectHint");
      const customHint = document.getElementById("customHint");

      function clamp01(v) { return Math.max(0, Math.min(1, v)); }

      function pointToFraction(clientX, clientY) {
        const rect = videoEl.getBoundingClientRect();
        return { x: clamp01((clientX - rect.left) / rect.width), y: clamp01((clientY - rect.top) / rect.height) };
      }

      function resizeCustomRect(start, handle, cur) {
        let left = start.x, top = start.y, right = start.x + start.w, bottom = start.y + start.h;
        if (handle.includes("w")) left = Math.min(cur.x, right - MIN_CUSTOM);
        if (handle.includes("e")) right = Math.max(cur.x, left + MIN_CUSTOM);
        if (handle.includes("n")) top = Math.min(cur.y, bottom - MIN_CUSTOM);
        if (handle.includes("s")) bottom = Math.max(cur.y, top + MIN_CUSTOM);
        left = clamp01(left); right = clamp01(right); top = clamp01(top); bottom = clamp01(bottom);
        return { x: left, y: top, w: right - left, h: bottom - top };
      }

      function applyPreviewTransform(actions) {
        if (!actions || actions.length === 0) { videoEl.style.transform = ""; return; }
        let transform = actions.map((a) => TRANSFORMS[a]).join(" ");
        if (actions.some((a) => ROTATE_90_ACTIONS.has(a))) {
          const { width, height } = videoEl.getBoundingClientRect();
          const fitScale = Math.min(width / height, height / width);
          transform += ` scale(${fitScale})`;
        }
        videoEl.style.transform = transform;
      }

      function updateCropBox() {
        if (!selectedAspect) {
          cropOverlay.hidden = true;
          cropOverlay.classList.remove("drawable");
          cropBox.classList.remove("resizable");
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
          if (!customRect) { cropBox.hidden = true; return; }
          const w = videoEl.clientWidth, h = videoEl.clientHeight;
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
        const w = videoEl.clientWidth, h = videoEl.clientHeight;
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
