/* Studio : réunit tous les outils sur une seule page via des onglets, chacun chargeant
   la page existante de l'outil dans une iframe. Le fichier en cours (project_id) est
   transmis d'un onglet à l'autre via l'URL (?project=<id>), et remonté ici via
   postMessage à chaque fois qu'un traitement se termine (voir renderSendTo dans common.js). */

const STUDIO_TABS = [
  { key: "extract_audio", path: "/", label: "Extraction audio", icon: "headphones" },
  { key: "trim_media", path: "/trim", label: "Trim media", icon: "scissors" },
  { key: "speed_media", path: "/speed", label: "Speed", icon: "speed" },
  { key: "orientation", path: "/orientation", label: "Orientation", icon: "orientation" },
  { key: "compress_media", path: "/compress", label: "Compression vidéo", icon: "compress" },
  { key: "screen_record", path: "/record", label: "Enregistrement écran", icon: "record" },
  { key: "noise_removal", path: "/noise-removal", label: "Suppression bruit", icon: "noise" },
];

(function () {
  const tabsEl = document.getElementById("studioTabs");
  const frame = document.getElementById("studioFrame");

  const initialParams = new URLSearchParams(window.location.search);
  let currentProjectId = initialParams.get("project") || null;
  let activeKey = STUDIO_TABS[0].key;

  const buttons = {};

  function frameSrc(tab) {
    return currentProjectId ? `${tab.path}?project=${currentProjectId}` : tab.path;
  }

  function renderTabs() {
    tabsEl.innerHTML = "";
    STUDIO_TABS.forEach((tab) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "studio-tab" + (tab.key === activeKey ? " active" : "");
      btn.innerHTML = `<span class="icon">${ICONS[tab.icon] || ""}</span><span>${tab.label}</span>`;
      btn.addEventListener("click", () => selectTab(tab.key));
      buttons[tab.key] = btn;
      tabsEl.appendChild(btn);
    });
  }

  function selectTab(key, opts = {}) {
    const tab = STUDIO_TABS.find((t) => t.key === key);
    if (!tab) return;
    activeKey = key;
    Object.entries(buttons).forEach(([k, btn]) => btn.classList.toggle("active", k === key));
    if (opts.forceReload || frame.dataset.currentPath !== tab.path || frame.dataset.projectId !== (currentProjectId || "")) {
      frame.src = frameSrc(tab);
      frame.dataset.currentPath = tab.path;
      frame.dataset.projectId = currentProjectId || "";
    }
  }

  window.addEventListener("message", (e) => {
    if (e.origin !== window.location.origin) return;
    const data = e.data;
    if (!data || data.type !== "stone-studio:project-updated") return;
    currentProjectId = data.projectId;
  });

  renderTabs();
  selectTab(activeKey, { forceReload: true });
})();
