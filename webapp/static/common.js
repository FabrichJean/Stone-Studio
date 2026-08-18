function formatBytesCommon(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatDurationCommon(seconds) {
  if (seconds === null || seconds === undefined) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function thumbHtmlCommon(p) {
  if (p.has_thumbnail) {
    return `<img class="thumb-img" src="/api/projects/${p.id}/thumbnail" alt="" loading="lazy" />`;
  }
  return `<span class="thumb-icon">${TOOL_ICONS[p.tool] || ""}</span>`;
}

function durationBadgeCommon(p) {
  const d = formatDurationCommon(p.duration);
  return d ? `<span class="thumb-duration">${d}</span>` : "";
}

function metaLineCommon(p) {
  const parts = [p.tool_label];
  const d = formatDurationCommon(p.duration);
  if (d) parts.push(d);
  if (p.width && p.height) parts.push(`${p.width}×${p.height}`);
  parts.push(formatBytesCommon(p.output_size));
  return parts.join(" · ");
}

/* ---------- Sélecteur inline (remplace la zone de drop) ---------- */

let pickerProjects = [];
let pickerViewMode = localStorage.getItem("ss_view_mode") || "list";

function closeProjectPicker() {
  document.getElementById("projectPicker").hidden = true;
  document.getElementById("dropzone").hidden = false;
}

function renderPickerList(filter, onSelect) {
  const q = filter.trim().toLowerCase();
  const filtered = pickerProjects.filter((p) => p.output_name.toLowerCase().includes(q));
  const list = document.getElementById("pickerList");
  list.className = pickerViewMode === "card" ? "picker-inline-list picker-grid" : "picker-inline-list";

  list.innerHTML = filtered.length
    ? filtered.map((p) => (pickerViewMode === "card" ? pickerCardHtml(p) : pickerRowHtml(p))).join("")
    : `<div class="picker-empty">Aucun fichier trouvé.</div>`;

  list.querySelectorAll("[data-id]").forEach((el) => {
    el.addEventListener("click", async () => {
      const record = pickerProjects.find((p) => p.id === el.dataset.id);
      el.classList.add("picker-item-loading");
      try {
        const res = await fetch(`/api/projects/${record.id}/download`);
        const blob = await res.blob();
        const file = new File([blob], record.output_name, { type: blob.type });
        closeProjectPicker();
        onSelect(file);
      } catch {
        el.classList.remove("picker-item-loading");
        alert("Erreur lors du chargement du fichier.");
      }
    });
  });
}

function pickerRowHtml(p) {
  return `
    <div class="picker-item" data-id="${p.id}">
      <div class="picker-thumb">${thumbHtmlCommon(p)}${durationBadgeCommon(p)}</div>
      <div class="picker-info">
        <span class="picker-name">${p.output_name}</span>
        <span class="picker-meta">${metaLineCommon(p)}</span>
      </div>
    </div>`;
}

function pickerCardHtml(p) {
  return `
    <div class="picker-card" data-id="${p.id}">
      <div class="picker-card-thumb">${thumbHtmlCommon(p)}${durationBadgeCommon(p)}</div>
      <div class="picker-card-name">${p.output_name}</div>
      <div class="picker-card-meta">${metaLineCommon(p)}</div>
    </div>`;
}

function setPickerViewMode(mode, onSelect) {
  pickerViewMode = mode;
  localStorage.setItem("ss_view_mode", mode);
  document.querySelectorAll("#pickerViewToggle .view-toggle-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === mode);
  });
  renderPickerList(document.getElementById("pickerSearch").value, onSelect);
}

async function openProjectPicker(onSelect) {
  const dropzone = document.getElementById("dropzone");
  const panel = document.getElementById("projectPicker");
  const searchInput = document.getElementById("pickerSearch");

  try {
    const res = await fetch("/api/projects");
    pickerProjects = await res.json();
  } catch {
    alert("Impossible de charger les projets.");
    return;
  }

  dropzone.hidden = true;
  panel.hidden = false;

  searchInput.value = "";
  document.querySelectorAll("#pickerViewToggle .view-toggle-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === pickerViewMode);
    b.onclick = () => setPickerViewMode(b.dataset.view, onSelect);
  });

  renderPickerList("", onSelect);
  searchInput.focus();

  searchInput.oninput = () => renderPickerList(searchInput.value, onSelect);
  document.getElementById("pickerBack").onclick = () => closeProjectPicker();
}
