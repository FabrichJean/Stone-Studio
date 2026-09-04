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
  { type: "orientation", label: "Screen", icon: "orientation" },
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
  const activeClipBanner = document.getElementById("activeClipBanner");
  const activeClipNameEl = document.getElementById("activeClipName");
  const panelReplaceBrowse = document.getElementById("panelReplaceBrowse");
  const panelReplaceInput = document.getElementById("panelReplaceInput");
  const panelReplaceProject = document.getElementById("panelReplaceProject");
  const panelPickerModal = document.getElementById("panelProjectPickerModal");
  const panelPickerList = document.getElementById("panelPickerList");
  const panelPickerSearch = document.getElementById("panelPickerSearch");
  const panelPickerClose = document.getElementById("panelPickerClose");
  const studioSide = document.getElementById("studioSide");
  const studioResizer = document.getElementById("studioResizer");
  const panelCollapseToggle = document.getElementById("panelCollapseToggle");
  const expandPanelBtn = document.getElementById("expandPanelBtn");
  const studioPanelModal = document.getElementById("studioPanelModal");
  const studioPanelModalBody = document.getElementById("studioPanelModalBody");
  const studioPanelModalClose = document.getElementById("studioPanelModalClose");
  const videoEl = document.getElementById("studioVideo");
  const audioEl = document.getElementById("studioAudio");
  const panelVideo = document.getElementById("panelVideo");
  const panelAudio = document.getElementById("panelAudio");
  const panelCropWrap = document.getElementById("panelCropWrap");
  const panelCropOverlay = document.getElementById("panelCropOverlay");
  const panelCropBox = document.getElementById("panelCropBox");
  const overlay = document.getElementById("previewOverlay");
  const overlayLabel = document.getElementById("previewOverlayLabel");
  const timelineTrack = document.getElementById("timelineTrack");
  const timelineRuler = document.getElementById("timelineRuler");
  const studioTimelinePanel = document.getElementById("studioTimelinePanel");
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

  /* ===================== Redimensionnement du panneau latéral ===================== */
  (function initSidePanelResize() {
    const STORAGE_KEY = "ss_studio_side_width";
    const MIN_WIDTH = 260;
    const MAX_WIDTH = 560;

    const saved = parseInt(localStorage.getItem(STORAGE_KEY), 10);
    if (saved && saved >= MIN_WIDTH && saved <= MAX_WIDTH) {
      studioSide.style.width = `${saved}px`;
    }

    let resizing = false;
    let collapsed = false;

    studioResizer.addEventListener("pointerdown", (e) => {
      if (collapsed || e.target === panelCollapseToggle) return;
      e.preventDefault();
      resizing = true;
      studioResizer.classList.add("dragging");
      document.body.style.userSelect = "none";
    });

    window.addEventListener("pointermove", (e) => {
      if (!resizing) return;
      const bodyRect = studioResizer.parentElement.getBoundingClientRect();
      const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, bodyRect.right - e.clientX));
      studioSide.style.width = `${width}px`;
    });

    window.addEventListener("pointerup", () => {
      if (!resizing) return;
      resizing = false;
      studioResizer.classList.remove("dragging");
      document.body.style.userSelect = "";
      localStorage.setItem(STORAGE_KEY, Math.round(parseFloat(studioSide.style.width)));
    });

    panelCollapseToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      collapsed = !collapsed;
      studioSide.classList.toggle("studio-side-collapsed", collapsed);
      studioResizer.classList.toggle("collapsed", collapsed);
      panelCollapseToggle.title = collapsed ? "Étendre le panneau" : "Réduire le panneau";
    });
  })();

  /* ===================== Panneau agrandi en modal ===================== */
  // Déplace le vrai nœud DOM #studioSide dans la modal (au lieu d'en reconstruire une copie) :
  // tous les écouteurs déjà attachés (piste de découpage, recadrage...) restent valides.
  (function initPanelExpand() {
    const sidePlaceholder = document.createComment("studio-side-slot");
    studioSide.after(sidePlaceholder);

    let savedInlineWidth = "";

    function expand() {
      savedInlineWidth = studioSide.style.width; // fixée en px par le redimensionnement manuel
      studioSide.style.width = ""; // sinon elle prime sur la règle CSS .studio-side-expanded
      studioPanelModalBody.appendChild(studioSide);
      studioSide.classList.add("studio-side-expanded");
      studioPanelModal.hidden = false;
      void studioPanelModal.offsetWidth;
      studioPanelModal.classList.add("open");
    }

    function collapse() {
      if (studioPanelModal.hidden) return;
      studioPanelModal.classList.remove("open");
      studioPanelModal.addEventListener("transitionend", function onEnd(e) {
        if (e.target !== studioPanelModal) return;
        studioPanelModal.removeEventListener("transitionend", onEnd);
        studioPanelModal.hidden = true;
        sidePlaceholder.parentNode.insertBefore(studioSide, sidePlaceholder);
        studioSide.classList.remove("studio-side-expanded");
        studioSide.style.width = savedInlineWidth;
      });
    }

    expandPanelBtn.addEventListener("click", expand);
    studioPanelModalClose.addEventListener("click", collapse);
    studioPanelModal.addEventListener("click", (e) => { if (e.target === studioPanelModal) collapse(); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !studioPanelModal.hidden) collapse();
    });
  })();

  const PX_PER_SEC = 40;
  const MIN_CLIP_PX = 50;

  let timeline = []; // { id: projectId, name, mediaType, size, duration, hasFilmstrip, localUrl?, pending? }
  let activeIndex = -1;
  let selectedType = STUDIO_ACTIONS[0].type;
  let destination = "replace"; // "replace" | "add"

  // Source que l'outil va réellement traiter : par défaut le clip actif de la timeline,
  // mais "Remplacer le fichier" peut la remplacer par un autre fichier sans toucher à la
  // timeline elle-même (le remplacement de la timeline ne se fait qu'en appliquant l'outil).
  let stagedSource = null; // { id, name, mediaType, duration, hasFilmstrip, localUrl }
  let dragSourceIndex = null; // index du clip en cours de glisser-déposer dans la timeline
  let dragStartX = null;
  let dragStartY = null;
  let dragEngaged = false; // ne devient true qu'une fois le seuil de déplacement franchi
  let dragGhost = null; // clone flottant (position: fixed) qui suit le pointeur pendant le glisser
  let dragGrabOffsetX = 0;
  let dragGrabOffsetY = 0;

  function toolInputClip() {
    return stagedSource || timeline[activeIndex];
  }

  // Élément média utilisé pendant la CONFIGURATION d'une action (piste de découpage,
  // recadrage, prévisualisation) : c'est celui du panneau de droite, pas l'aperçu
  // principal (qui reste dédié à la lecture globale de la timeline).
  function activeMediaEl() {
    const clip = toolInputClip();
    return clip && clip.mediaType === "audio" ? panelAudio : panelVideo;
  }

  function activeDuration() {
    const clip = toolInputClip();
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
  let transportEndedHandler = null;
  let transportRafId = null;
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
      if (transportEndedHandler) m.removeEventListener("ended", transportEndedHandler);
    });
    if (transportRafId !== null) { cancelAnimationFrame(transportRafId); transportRafId = null; }
  }

  // Le curseur avance à chaque frame (plutôt qu'à chaque événement "timeupdate", trop peu
  // fréquent — quelques fois par seconde) pour un mouvement fluide pendant la lecture.
  function tickPlayheadFrame(media) {
    if (!transportPlaying) return;
    playheadTime = clipStartTime(playingIndex) + media.currentTime;
    updatePlayheadUI();
    transportRafId = requestAnimationFrame(() => tickPlayheadFrame(media));
  }

  function attachTransportTracking(media) {
    detachTransportTracking();
    if (!media) return;
    transportEndedHandler = () => advanceTransport();
    media.addEventListener("ended", transportEndedHandler);
    transportRafId = requestAnimationFrame(() => tickPlayheadFrame(media));
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
    // Un clic/glisser qui démarre sur un clip est géré par son propre pointerdown (sélection
    // ou réordonnancement) — laisser le scrub de la tête de lecture s'en emparer aussi créait
    // un conflit où le scrub gagnait systématiquement.
    if (timeline.length === 0 || e.target.closest(".studio-clip")) return;
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
    stagedSource = null;
    playingIndex = -1;
    playheadTime = 0;
    updateActiveClipBanner();
    destination = "replace";
    selectedType = STUDIO_ACTIONS[0].type;
    videoEl.src = ""; audioEl.src = "";
    panelVideo.src = ""; panelAudio.src = "";
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

  function updateActiveClipBanner() {
    const clip = toolInputClip();
    if (!clip) { activeClipBanner.hidden = true; return; }
    activeClipBanner.hidden = false;
    activeClipNameEl.textContent = clip.name + (stagedSource ? " (remplacement)" : "");

    const src = clip.localUrl || `/api/projects/${clip.id}/download`;
    if (clip.mediaType === "audio") {
      panelAudio.src = src; panelAudio.hidden = false;
      panelCropWrap.hidden = true; panelVideo.src = "";
    } else {
      panelVideo.src = src; panelCropWrap.hidden = false;
      panelAudio.hidden = true; panelAudio.src = "";
    }
    panelVideo.style.transform = "";
  }

  function setActiveClip(index) {
    if (transportPlaying) pauseTransport();
    activeIndex = index;
    stagedSource = null;
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
    updateActiveClipBanner();
    renderTimeline();
    selectAction(selectedType);
  }

  // Remplace la source que l'outil va traiter, SANS toucher au clip actif de la timeline
  // (celui-ci n'est remplacé que si on applique ensuite l'outil avec "Remplacer le contenu
  // actif") — utile pour essayer un outil sur un autre fichier sans reconstruire la timeline.
  function replaceToolInput(file) {
    if (activeIndex < 0) return;
    const mediaType = file.type.startsWith("audio/") ? "audio" : "video";
    const localUrl = URL.createObjectURL(file);
    stagedSource = { id: null, name: file.name, mediaType, size: file.size, duration: null, hasFilmstrip: false, localUrl };
    updateActiveClipBanner();
    selectAction(selectedType);

    // Le panneau (piste de découpage, etc.) vient d'être construit avec une durée de 0 : les
    // métadonnées du nouveau fichier ne sont pas encore chargées à ce stade. On le reconstruit
    // dès qu'elles le sont, sinon la sélection reste figée sur 00:00:00 → 00:00:00.
    const mediaEl = mediaType === "audio" ? panelAudio : panelVideo;
    mediaEl.addEventListener("loadedmetadata", function onMeta() {
      mediaEl.removeEventListener("loadedmetadata", onMeta);
      if (stagedSource && stagedSource.localUrl === localUrl && !stagedSource.duration) {
        stagedSource.duration = mediaEl.duration;
        if (CUSTOM_PANELS[selectedType]) selectAction(selectedType);
      }
    });

    const formData = new FormData();
    formData.append("file", file);
    fetch("/api/studio/upload", { method: "POST", body: formData })
      .then((r) => r.json())
      .then((record) => {
        if (!stagedSource || stagedSource.localUrl !== localUrl) return; // remplacé de nouveau entre-temps
        stagedSource.id = record.id;
        stagedSource.duration = record.duration;
        stagedSource.hasFilmstrip = record.has_filmstrip;
        stagedSource.mediaType = record.media_type;
      })
      .catch(() => { statusEl.textContent = "Erreur lors de l'import du fichier."; statusEl.className = "status error"; });
  }

  panelReplaceBrowse.addEventListener("click", () => panelReplaceInput.click());
  panelReplaceInput.addEventListener("change", () => {
    if (panelReplaceInput.files.length) replaceToolInput(panelReplaceInput.files[0]);
    panelReplaceInput.value = "";
  });
  // Écouté sur le conteneur ET sur les éléments média eux-mêmes : un <video controls> peut
  // absorber les événements de glisser-déposer différemment selon le navigateur, donc on
  // s'assure que le drop fonctionne peu importe où exactement le fichier est lâché.
  [activeClipBanner, panelCropWrap, panelVideo, panelAudio].forEach((el) => {
    el.addEventListener("dragenter", (e) => { e.preventDefault(); });
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      activeClipBanner.classList.add("dragover");
    });
    el.addEventListener("dragleave", (e) => {
      if (e.relatedTarget && activeClipBanner.contains(e.relatedTarget)) return;
      activeClipBanner.classList.remove("dragover");
    });
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      activeClipBanner.classList.remove("dragover");
      if (e.dataTransfer.files.length) replaceToolInput(e.dataTransfer.files[0]);
    });
  });

  /* ===================== Glisser-déposer un fichier directement dans la timeline ===================== */
  // Contrairement au dépôt sur le panneau (qui ne remplace que l'entrée de l'outil), déposer
  // un fichier sur la timeline l'ajoute comme nouveau clip à la suite, sans passer par un outil.

  function addFileToTimeline(file) {
    const mediaType = file.type.startsWith("audio/") ? "audio" : "video";
    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    timeline.push({ tempId, pending: true, mediaType, duration: null, name: file.name });
    renderTimeline();

    const formData = new FormData();
    formData.append("file", file);
    fetch("/api/studio/upload", { method: "POST", body: formData })
      .then((r) => r.json())
      .then((record) => {
        const idx = timeline.findIndex((c) => c.tempId === tempId);
        if (idx === -1) return;
        timeline[idx] = {
          id: record.id, name: record.output_name, mediaType: record.media_type,
          size: record.output_size, duration: record.duration, hasFilmstrip: record.has_filmstrip,
        };
        renderTimeline();
      })
      .catch(() => {
        const idx = timeline.findIndex((c) => c.tempId === tempId);
        if (idx !== -1) { timeline.splice(idx, 1); renderTimeline(); }
        statusEl.textContent = "Erreur lors de l'import du fichier.";
        statusEl.className = "status error";
      });
  }

  studioTimelinePanel.addEventListener("dragenter", (e) => { e.preventDefault(); });
  studioTimelinePanel.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    studioTimelinePanel.classList.add("dragover");
  });
  studioTimelinePanel.addEventListener("dragleave", (e) => {
    if (e.relatedTarget && studioTimelinePanel.contains(e.relatedTarget)) return;
    studioTimelinePanel.classList.remove("dragover");
  });
  studioTimelinePanel.addEventListener("drop", (e) => {
    e.preventDefault();
    studioTimelinePanel.classList.remove("dragover");
    Array.from(e.dataTransfer.files).forEach(addFileToTimeline);
  });

  /* ===================== Choisir un projet existant comme remplacement ===================== */

  let panelPickerProjects = [];

  function openPanelPicker() {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((projects) => {
        panelPickerProjects = projects;
        panelPickerSearch.value = "";
        renderPanelPickerList("");
        panelPickerModal.hidden = false;
        void panelPickerModal.offsetWidth;
        panelPickerModal.classList.add("open");
        panelPickerSearch.focus();
      })
      .catch(() => alert("Impossible de charger les projets."));
  }

  function closePanelPicker() {
    if (panelPickerModal.hidden) return;
    panelPickerModal.classList.remove("open");
    panelPickerModal.addEventListener("transitionend", function onEnd(e) {
      if (e.target !== panelPickerModal) return;
      panelPickerModal.removeEventListener("transitionend", onEnd);
      panelPickerModal.hidden = true;
    });
  }

  function renderPanelPickerList(filter) {
    const q = filter.trim().toLowerCase();
    const filtered = panelPickerProjects.filter((p) => p.output_name.toLowerCase().includes(q));
    panelPickerList.innerHTML = filtered.length
      ? filtered.map(pickerRowHtml).join("")
      : `<div class="picker-empty">Aucun fichier trouvé.</div>`;

    panelPickerList.querySelectorAll("[data-id]").forEach((el) => {
      el.addEventListener("click", async () => {
        const record = panelPickerProjects.find((p) => p.id === el.dataset.id);
        el.classList.add("picker-item-loading");
        try {
          const res = await fetch(`/api/projects/${record.id}/download`);
          const blob = await res.blob();
          const file = new File([blob], record.output_name, { type: blob.type });
          closePanelPicker();
          replaceToolInput(file);
        } catch {
          el.classList.remove("picker-item-loading");
          alert("Erreur lors du chargement du fichier.");
        }
      });
    });
  }

  panelReplaceProject.addEventListener("click", openPanelPicker);
  panelPickerClose.addEventListener("click", closePanelPicker);
  panelPickerSearch.addEventListener("input", () => renderPanelPickerList(panelPickerSearch.value));
  panelPickerModal.addEventListener("click", (e) => { if (e.target === panelPickerModal) closePanelPicker(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panelPickerModal.hidden) closePanelPicker();
  });

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
        // L'id du projet peut contenir des espaces/parenthèses (dérivé du nom de fichier
        // d'origine) : un url() CSS non guillemeté casse dès qu'il contient un espace.
        block.style.backgroundImage = `url("/api/projects/${encodeURIComponent(clip.id)}/filmstrip")`;
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

      // Réordonnancement au pointeur plutôt qu'au drag-and-drop natif HTML5 : ce dernier
      // exige que le navigateur considère explicitement le drop comme "accepté" sur chaque
      // cible, et rejoue sinon une animation de "retour à la case départ" peu fiable d'un
      // navigateur à l'autre. Le suivi manuel du pointeur est le même mécanisme déjà utilisé
      // pour les poignées de découpage et le scrub de la timeline — cohérent et robuste.
      block.addEventListener("pointerdown", (e) => {
        if (e.target.closest(".studio-clip-remove") || !clip.id) return;
        dragSourceIndex = i;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        dragEngaged = false;
      });

      timelineTrack.appendChild(block);
    });
    exportBtn.disabled = timeline.length === 0 || timeline.some((c) => c.pending);
    updatePlayheadUI();
  }

  function reorderClip(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex + 1 === toIndex) return;
    const activeClipRef = timeline[activeIndex];
    const playingClipRef = timeline[playingIndex];
    const [moved] = timeline.splice(fromIndex, 1);
    const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex;
    timeline.splice(insertAt, 0, moved);
    if (activeClipRef) activeIndex = timeline.indexOf(activeClipRef);
    if (playingClipRef) playingIndex = timeline.indexOf(playingClipRef);
    renderTimeline();
  }

  const DRAG_REORDER_THRESHOLD = 6;

  function positionDragGhost(e) {
    if (!dragGhost) return;
    dragGhost.style.left = `${e.clientX - dragGrabOffsetX}px`;
    dragGhost.style.top = `${e.clientY - dragGrabOffsetY}px`;
  }

  window.addEventListener("pointermove", (e) => {
    if (dragSourceIndex === null) return;
    if (!dragEngaged) {
      if (Math.abs(e.clientX - dragStartX) < DRAG_REORDER_THRESHOLD && Math.abs(e.clientY - dragStartY) < DRAG_REORDER_THRESHOLD) return;
      dragEngaged = true;
      const sourceBlock = timelineTrack.children[dragSourceIndex];
      if (sourceBlock) {
        sourceBlock.classList.add("dragging-clip");
        // Le clone flottant (position: fixed, hors du conteneur défilable) suit le pointeur —
        // en déplaçant le bloc original à la place, il se faisait couper par l'overflow du
        // scroll horizontal de la timeline dès qu'on dépassait son bord visible.
        const rect = sourceBlock.getBoundingClientRect();
        dragGrabOffsetX = dragStartX - rect.left;
        dragGrabOffsetY = dragStartY - rect.top;
        dragGhost = document.createElement("div");
        dragGhost.className = "studio-clip-ghost" + (sourceBlock.classList.contains("studio-clip-audio") ? " studio-clip-audio" : "");
        dragGhost.style.width = `${rect.width}px`;
        dragGhost.style.height = `${rect.height}px`;
        dragGhost.style.backgroundImage = sourceBlock.style.backgroundImage;
        const label = sourceBlock.querySelector(".studio-clip-label");
        if (label) dragGhost.innerHTML = `<span class="studio-clip-label">${label.textContent}</span>`;
        document.body.appendChild(dragGhost);
        positionDragGhost(e);
      }
    }
    positionDragGhost(e);

    timelineTrack.querySelectorAll(".drop-before, .drop-after").forEach((b) => b.classList.remove("drop-before", "drop-after"));
    // Le clone a pointer-events:none, donc elementFromPoint "voit à travers" jusqu'à la
    // vraie cible sous le curseur.
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest(".studio-clip");
    if (target && target.parentElement === timelineTrack) {
      const rect = target.getBoundingClientRect();
      const before = e.clientX - rect.left < rect.width / 2;
      target.classList.toggle("drop-before", before);
      target.classList.toggle("drop-after", !before);
    }
  });

  window.addEventListener("pointerup", (e) => {
    if (dragSourceIndex === null) return;
    const fromIndex = dragSourceIndex;
    const wasEngaged = dragEngaged;
    if (dragGhost) { dragGhost.remove(); dragGhost = null; }
    timelineTrack.querySelectorAll(".studio-clip").forEach((b) => b.classList.remove("dragging-clip", "drop-before", "drop-after"));
    dragSourceIndex = null;
    dragEngaged = false;
    if (!wasEngaged) return; // simple clic, pas un glisser
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest(".studio-clip");
    if (!target || target.parentElement !== timelineTrack) return;
    const targetIndex = Array.from(timelineTrack.children).indexOf(target);
    if (targetIndex === -1) return;
    const rect = target.getBoundingClientRect();
    const before = e.clientX - rect.left < rect.width / 2;
    reorderClip(fromIndex, targetIndex + (before ? 0 : 1));
  });

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
      panelVideo.removeEventListener("timeupdate", trackPlayheadHandler);
      panelAudio.removeEventListener("timeupdate", trackPlayheadHandler);
    }
    trackPlayheadHandler = () => {
      if (!track || !track.duration || !els.playhead.isConnected) return;
      const media = activeMediaEl();
      els.playhead.style.left = `${(media.currentTime / track.duration) * 100}%`;
    };
    panelVideo.addEventListener("timeupdate", trackPlayheadHandler);
    panelAudio.addEventListener("timeupdate", trackPlayheadHandler);

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
      if (!track.duration || track.end - track.start < MIN_GAP) {
        throw new Error("La sélection est invalide (durée du média pas encore chargée ?). Réessayez.");
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
          activeMediaEl().playbackRate = mode === "global" ? parseFloat(document.getElementById("speedGlobalFactor").value) : 1;
          if (mode === "segments" && !trackEls) {
            trackEls = initTrack(segmentsPanel);
            renderSpeedSegments();
          }
        });
      });

      // Le lecteur du panneau reflète immédiatement la vitesse choisie (utile en mode
      // global : jouer le lecteur donne un vrai aperçu du rendu, pas seulement le chiffre).
      document.getElementById("speedGlobalFactor").addEventListener("change", (e) => {
        if (mode === "global") activeMediaEl().playbackRate = parseFloat(e.target.value);
      });
      activeMediaEl().playbackRate = parseFloat(document.getElementById("speedGlobalFactor").value);

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
        const rect = panelVideo.getBoundingClientRect();
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
        if (!actions || actions.length === 0) { panelVideo.style.transform = ""; return; }
        let transform = actions.map((a) => TRANSFORMS[a]).join(" ");
        if (actions.some((a) => ROTATE_90_ACTIONS.has(a))) {
          const { width, height } = panelVideo.getBoundingClientRect();
          const fitScale = Math.min(width / height, height / width);
          transform += ` scale(${fitScale})`;
        }
        panelVideo.style.transform = transform;
      }

      function updateCropBox() {
        if (!selectedAspect) {
          panelCropOverlay.hidden = true;
          panelCropOverlay.classList.remove("drawable");
          panelCropBox.classList.remove("resizable");
          aspectHint.hidden = true;
          customHint.hidden = true;
          return;
        }
        if (selectedAspect === "custom") {
          panelCropOverlay.hidden = false;
          panelCropOverlay.classList.add("drawable");
          panelCropBox.classList.add("resizable");
          aspectHint.hidden = true;
          customHint.hidden = false;
          if (!customRect) { panelCropBox.hidden = true; return; }
          const w = panelVideo.clientWidth, h = panelVideo.clientHeight;
          panelCropBox.hidden = false;
          panelCropBox.style.left = `${customRect.x * w}px`;
          panelCropBox.style.top = `${customRect.y * h}px`;
          panelCropBox.style.width = `${customRect.w * w}px`;
          panelCropBox.style.height = `${customRect.h * h}px`;
          return;
        }
        panelCropOverlay.classList.remove("drawable");
        panelCropBox.classList.remove("resizable");
        panelCropBox.hidden = false;
        customHint.hidden = true;
        const w = panelVideo.clientWidth, h = panelVideo.clientHeight;
        if (!w || !h) return;
        const r = ASPECT_NUMERIC[selectedAspect];
        const videoAR = w / h;
        const widthCrop = videoAR > r;
        const boxW = widthCrop ? h * r : w;
        const boxH = widthCrop ? h : w / r;
        cropAxis = widthCrop ? "x" : "y";
        const maxOffset = widthCrop ? w - boxW : h - boxH;
        const offset = maxOffset * aspectPos;
        panelCropBox.style.width = `${boxW}px`;
        panelCropBox.style.height = `${boxH}px`;
        panelCropBox.style.left = `${widthCrop ? offset : 0}px`;
        panelCropBox.style.top = `${widthCrop ? 0 : offset}px`;
        panelCropOverlay.hidden = false;
        aspectHint.hidden = maxOffset < 1;
      }

      function hasAspectWork() {
        if (!selectedAspect) return false;
        return selectedAspect === "custom" ? !!customRect : true;
      }

      // --- Recadrage : gestionnaires globaux (retirés/reposés à chaque rendu du panneau) ---
      function onCropBoxDown(e) {
        if (selectedAspect === "custom") {
          if (e.target.classList.contains("crop-handle") || !customRect) return;
          e.preventDefault();
          customDragMode = "move";
          customDragStart = pointToFraction(e.clientX, e.clientY);
          customRectStart = { ...customRect };
          return;
        }
        e.preventDefault();
        draggingCrop = true;
      }

      function onCropOverlayDown(e) {
        if (selectedAspect !== "custom" || e.target !== panelCropOverlay) return;
        e.preventDefault();
        customDragMode = "draw";
        customDragStart = pointToFraction(e.clientX, e.clientY);
        customRect = { x: customDragStart.x, y: customDragStart.y, w: 0, h: 0 };
        updateCropBox();
      }

      function onWindowPointerMove(e) {
        if (customDragMode) {
          const cur = pointToFraction(e.clientX, e.clientY);
          if (customDragMode === "draw") {
            customRect = { x: Math.min(customDragStart.x, cur.x), y: Math.min(customDragStart.y, cur.y), w: Math.abs(cur.x - customDragStart.x), h: Math.abs(cur.y - customDragStart.y) };
          } else if (customDragMode === "move") {
            const dx = cur.x - customDragStart.x, dy = cur.y - customDragStart.y;
            customRect = {
              x: Math.max(0, Math.min(1 - customRectStart.w, customRectStart.x + dx)),
              y: Math.max(0, Math.min(1 - customRectStart.h, customRectStart.y + dy)),
              w: customRectStart.w, h: customRectStart.h,
            };
          } else if (customDragMode === "resize") {
            customRect = resizeCustomRect(customRectStart, customHandle, cur);
          }
          updateCropBox();
        }
        if (draggingCrop && cropAxis) {
          const rect = panelVideo.getBoundingClientRect();
          const boxW = panelCropBox.offsetWidth, boxH = panelCropBox.offsetHeight;
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
        }
      }

      function onWindowPointerUp() {
        if (customDragMode === "draw" && customRect && (customRect.w < MIN_CUSTOM || customRect.h < MIN_CUSTOM)) {
          customRect = null;
          updateCropBox();
        }
        customDragMode = null;
        customHandle = null;
        draggingCrop = false;
      }

      panelCropBox.addEventListener("pointerdown", onCropBoxDown);
      panelCropBox.querySelectorAll(".crop-handle").forEach((handle) => {
        handle.addEventListener("pointerdown", (e) => {
          if (selectedAspect !== "custom" || !customRect) return;
          e.preventDefault();
          e.stopPropagation();
          customDragMode = "resize";
          customHandle = handle.dataset.handle;
          customDragStart = pointToFraction(e.clientX, e.clientY);
          customRectStart = { ...customRect };
        });
      });
      panelCropOverlay.addEventListener("pointerdown", onCropOverlayDown);
      window.addEventListener("pointermove", onWindowPointerMove);
      window.addEventListener("pointerup", onWindowPointerUp);
      this._cleanupCrop = () => {
        panelCropBox.removeEventListener("pointerdown", onCropBoxDown);
        panelCropOverlay.removeEventListener("pointerdown", onCropOverlayDown);
        window.removeEventListener("pointermove", onWindowPointerMove);
        window.removeEventListener("pointerup", onWindowPointerUp);
        panelCropOverlay.hidden = true;
        panelVideo.style.transform = "";
      };

      container.querySelectorAll('[data-aspect]').forEach((btn) => {
        btn.addEventListener("click", () => {
          selectedAspect = btn.dataset.aspect;
          container.querySelectorAll('[data-aspect]').forEach((b) => b.classList.toggle("active", b === btn));
          aspectPos = 0.5;
          if (selectedAspect === "custom" && !customRect) customRect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
          updateCropBox();
        });
      });

      globalPanel.querySelectorAll("[data-action]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = globalActions.indexOf(btn.dataset.action);
          if (idx >= 0) globalActions.splice(idx, 1); else globalActions.push(btn.dataset.action);
          btn.classList.toggle("active");
          applyPreviewTransform(globalActions);
        });
      });

      document.getElementById("orientSegmentActions").querySelectorAll("[data-action]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = currentSegmentActions.indexOf(btn.dataset.action);
          if (idx >= 0) currentSegmentActions.splice(idx, 1); else currentSegmentActions.push(btn.dataset.action);
          btn.classList.toggle("active");
          applyPreviewTransform(currentSegmentActions);
        });
      });

      container.querySelectorAll(".mode-toggle-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          mode = btn.dataset.mode;
          container.querySelectorAll(".mode-toggle-btn").forEach((b) => b.classList.toggle("active", b === btn));
          globalPanel.hidden = mode !== "global";
          segmentsPanel.hidden = mode !== "segments";
          panelVideo.style.transform = "";
          document.getElementById("aspectSectionTitle").textContent =
            mode === "global" ? "Format d'affichage (résultat final)" : "Format d'affichage de ce morceau";
          if (mode === "segments" && !trackEls) {
            trackEls = initTrack(segmentsPanel);
            renderOrientSegments();
          }
        });
      });

      function renderOrientSegments() {
        const list = document.getElementById("orientSegmentsList");
        if (!list) return;
        if (track.segments.length === 0) {
          list.innerHTML = `<div class="segments-empty">Aucun morceau ajouté.</div>`;
          return;
        }
        list.innerHTML = track.segments.map((seg, i) => {
          const tags = seg.actions.map((a) => ACTION_LABELS[a]);
          if (seg.aspectRatio) tags.push(ASPECT_LABELS[seg.aspectRatio]);
          return `
          <div class="segment-item" data-index="${i}" title="Cliquer pour prévisualiser ce morceau">
            <span>
              <span class="segment-label">${i + 1}. ${secondsToTimestamp(seg.start)} → ${secondsToTimestamp(seg.end)}</span>
              <span class="segment-speed-tag">${tags.join(" + ") || "aucun changement"}</span>
            </span>
            <button type="button" class="segment-remove" data-index="${i}" title="Retirer">✕</button>
          </div>`;
        }).join("");
        list.querySelectorAll(".segment-item").forEach((el) => {
          el.addEventListener("click", (e) => {
            if (e.target.closest(".segment-remove")) return;
            const seg = track.segments[Number(el.dataset.index)];
            applyPreviewTransform(seg.actions);
            playRanges(panelVideo, [seg]);
          });
        });
        list.querySelectorAll(".segment-remove").forEach((btn) => {
          btn.addEventListener("click", () => {
            track.segments.splice(Number(btn.dataset.index), 1);
            renderOrientSegments();
            if (trackEls) renderTrackMarkers(trackEls);
          });
        });
      }

      document.getElementById("orientPreviewBtn")?.addEventListener("click", () => {
        applyPreviewTransform(currentSegmentActions);
        playRanges(panelVideo, [{ start: track.start, end: track.end }]);
      });

      document.getElementById("orientAddSegmentBtn")?.addEventListener("click", () => {
        if (currentSegmentActions.length === 0 && !hasAspectWork()) {
          statusEl.textContent = "Choisissez au moins une orientation ou un format pour ce morceau.";
          statusEl.className = "status error";
          return;
        }
        const addedEnd = track.end;
        track.segments.push({
          start: track.start, end: track.end, actions: [...currentSegmentActions],
          aspectRatio: selectedAspect || null, aspectPos, cropRect: selectedAspect === "custom" ? customRect : null,
        });
        track.segments.sort((a, b) => a.start - b.start);
        renderOrientSegments();
        updateTrackUI(trackEls);
        if (addedEnd < track.duration - MIN_GAP) {
          track.start = addedEnd;
          track.end = track.duration;
          panelVideo.currentTime = track.start;
          updateTrackUI(trackEls);
        }
      });

      track = { duration: activeDuration(), start: 0, end: activeDuration(), segments: [], dragging: null };
      this._getState = () => ({ mode, selectedAspect, aspectPos, customRect, globalActions, hasAspectWork });
    },
    collect() {
      const { mode, selectedAspect, aspectPos, customRect, globalActions, hasAspectWork } = this._getState();
      if (mode === "segments") {
        if (!track.segments.length) throw new Error("Ajoutez au moins un morceau.");
        return {
          mode: "segments",
          segments: track.segments.map((s) => ({
            start: secondsToTimestamp(s.start), end: secondsToTimestamp(s.end), actions: s.actions,
            aspect_ratio: s.aspectRatio === "custom" ? null : s.aspectRatio,
            aspect_position: s.aspectPos,
            crop_rect: s.aspectRatio === "custom" ? s.cropRect : null,
          })),
        };
      }
      if (globalActions.length === 0 && !hasAspectWork()) throw new Error("Choisissez au moins une orientation ou un format d'affichage.");
      const params = { mode: "single", actions: globalActions };
      if (selectedAspect === "custom" && customRect) {
        params.crop_rect = customRect;
      } else if (selectedAspect) {
        params.aspect_ratio = selectedAspect;
        params.aspect_position = aspectPos;
      }
      return params;
    },
    cleanup() {
      if (this._cleanupCrop) this._cleanupCrop();
    },
  };

  const CUSTOM_PANELS = { trim: TrimPanel, speed: SpeedPanel, orientation: OrientationPanel };
  let activeCustomPanel = null;

  /* ===================== Barre d'onglets + panneau d'action ===================== */

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
    if (activeCustomPanel && activeCustomPanel.cleanup) activeCustomPanel.cleanup();
    activeCustomPanel = null;
    panelVideo.playbackRate = 1;
    panelAudio.playbackRate = 1;
    selectedType = type;
    renderTabs();

    const label = destination === "add" ? "Ajouter à la timeline" : "Remplacer le contenu actif";
    const destinationHtml = `
      <div class="studio-destination-toggle">
        <button type="button" class="studio-destination-btn${destination === "replace" ? " active" : ""}" data-dest="replace">Remplacer le contenu actif</button>
        <button type="button" class="studio-destination-btn${destination === "add" ? " active" : ""}" data-dest="add">Ajouter à la timeline</button>
      </div>`;

    panelEl.innerHTML = `<h3>${STUDIO_ACTIONS.find((a) => a.type === type).label}</h3>${destinationHtml}<div id="actionBody"></div>
      <div class="studio-panel-actions">
        <button type="button" class="btn-primary" id="applyActionBtn">${label}</button>
      </div>`;

    const body = document.getElementById("actionBody");
    if (CUSTOM_PANELS[type]) {
      activeCustomPanel = CUSTOM_PANELS[type];
      activeCustomPanel.render(body);
    } else {
      body.innerHTML = FORMS[type].html({});
      if (FORMS[type].init) FORMS[type].init();
    }

    panelEl.querySelectorAll("[data-dest]").forEach((btn) => {
      btn.addEventListener("click", () => { destination = btn.dataset.dest; selectAction(type); });
    });
    document.getElementById("applyActionBtn").addEventListener("click", applyAction);
  }

  function applyAction() {
    if (activeIndex < 0) return;
    const activeClip = toolInputClip();
    if (!activeClip.id) { statusEl.textContent = "Le fichier est encore en cours d'import…"; statusEl.className = "status"; return; }

    let params;
    try {
      params = CUSTOM_PANELS[selectedType] ? CUSTOM_PANELS[selectedType].collect() : FORMS[selectedType].collect();
    } catch (e) {
      statusEl.textContent = e.message;
      statusEl.className = "status error";
      return;
    }

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
          stagedSource = null;
          updateActiveClipBanner();
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

  /* ===================== Export final (assemble la timeline) ===================== */

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

  // Permet d'arriver directement sur Studio avec un projet déjà chargé (ex: depuis la page
  // Projets), sans passer par l'écran d'import.
  function loadProjectFromId(projectId) {
    fetch(`/api/projects/${projectId}`)
      .then((r) => { if (!r.ok) throw new Error("not found"); return r.json(); })
      .then((record) => {
        fileNameEl.textContent = record.output_name;
        fileMetaEl.textContent = formatBytesCommon(record.output_size);
        studioEmpty.hidden = true;
        studioMain.hidden = false;
        timeline = [{
          id: record.id, name: record.output_name, mediaType: record.media_type,
          size: record.output_size, duration: record.duration, hasFilmstrip: record.has_filmstrip,
        }];
        activeIndex = 0;
        setActiveClip(0);
      })
      .catch(() => {
        statusEl.textContent = "Impossible de charger ce projet.";
        statusEl.className = "status error";
      });
  }

  renderTabs();
  selectAction(selectedType);
  renderTimeline();

  const deepLinkProjectId = new URLSearchParams(window.location.search).get("project");
  if (deepLinkProjectId) {
    window.history.replaceState({}, "", window.location.pathname);
    loadProjectFromId(deepLinkProjectId);
  }
})();
