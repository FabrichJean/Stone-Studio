let allProjects = [];
let projectsViewMode = localStorage.getItem("ss_view_mode") || "list";
let searchQuery = "";
let filters = { tool: "all", type: "all", sort: "new" };
const collapsedSections = new Set();

const CHEVRON_ICON = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>`;
const MENU_DOTS_ICON = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></svg>`;

function projectRowHtml(p) {
  const files = p.is_source
    ? `<span class="project-output">${p.output_name}</span>`
    : `<span class="project-input" title="${p.input_name}">${p.input_name}</span>
       <span class="project-arrow">→</span>
       <span class="project-output" title="${p.output_name}">${p.output_name}</span>`;

  return `
    <div class="project-card">
      <div class="project-thumb">${thumbHtmlCommon(p)}${durationBadgeCommon(p)}</div>
      <div class="project-main">
        <div class="project-tool">${p.tool_label}</div>
        <div class="project-files">${files}</div>
        <div class="project-meta">
          <span>${p.created_at.slice(0, 16).replace("T", " ")}</span>
          <span>${metaLineCommon(p)}</span>
        </div>
      </div>
      <a class="btn-download" href="/api/projects/${p.id}/download" download>${ICONS.download} Télécharger</a>
    </div>`;
}

function projectCardHtml(p) {
  const title = p.is_source ? p.output_name : `${p.input_name} → ${p.output_name}`;
  return `
    <div class="project-grid-card" data-id="${p.id}">
      <div class="project-grid-thumb">
        ${thumbHtmlCommon(p)}${durationBadgeCommon(p)}
        <button type="button" class="project-card-menu-btn" title="Options">${MENU_DOTS_ICON}</button>
        <div class="project-card-menu" hidden>
          <button type="button" class="project-card-menu-item" data-action="download">Télécharger</button>
          <button type="button" class="project-card-menu-item" data-action="open-studio">Ouvrir dans Studio</button>
          <button type="button" class="project-card-menu-item project-card-menu-item-danger" data-action="delete">Supprimer</button>
        </div>
      </div>
      <div class="project-grid-name" title="${title}">${p.output_name}</div>
      <div class="project-grid-meta">${metaLineCommon(p)}</div>
    </div>`;
}

/* ---------- Filtrage / tri ---------- */

function filteredProjects() {
  const q = searchQuery.trim().toLowerCase();
  return allProjects.filter((p) => {
    if (filters.type !== "all" && p.media_type !== filters.type) return false;
    if (!q) return true;
    return (p.output_name || "").toLowerCase().includes(q) || (p.input_name || "").toLowerCase().includes(q);
  });
}

function sortProjects(list) {
  const sorted = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return filters.sort === "old" ? sorted : sorted.reverse();
}

function toolLabelFor(tool) {
  const record = allProjects.find((p) => p.tool === tool);
  return (record && record.tool_label) || tool;
}

/* ---------- Rendu ---------- */

function renderSection(title, items, key) {
  const collapsed = collapsedSections.has(key);
  const body = key === "recents"
    ? `<div class="projects-section-row">${items.map(projectCardHtml).join("")}</div>`
    : `<div class="${projectsViewMode === "card" ? "projects-grid" : "projects-list"}">${items.map((p) => (projectsViewMode === "card" ? projectCardHtml(p) : projectRowHtml(p))).join("")}</div>`;

  return `
    <div class="projects-section${collapsed ? " collapsed" : ""}" data-section="${key}">
      <div class="projects-section-header">
        <span class="chevron">${CHEVRON_ICON}</span>
        <h2>${title}</h2>
        <span class="count">${items.length}</span>
      </div>
      <div class="projects-section-body">${body}</div>
    </div>`;
}

function wireSectionToggles() {
  document.querySelectorAll(".projects-section-header").forEach((header) => {
    header.addEventListener("click", () => {
      const section = header.closest(".projects-section");
      const key = section.dataset.section;
      const collapsed = section.classList.toggle("collapsed");
      if (collapsed) collapsedSections.add(key); else collapsedSections.delete(key);
    });
  });
}

function renderProjects() {
  const container = document.getElementById("projectsContainer");
  const countEl = document.getElementById("projectsCount");

  if (!allProjects.length) {
    container.className = "";
    countEl.textContent = "";
    container.innerHTML = `<div class="panel projects-empty"><p>Aucun projet pour le moment. Les fichiers traités via les outils apparaîtront ici.</p></div>`;
    return;
  }

  let projects = filteredProjects();
  if (filters.tool !== "all") projects = projects.filter((p) => p.tool === filters.tool);
  projects = sortProjects(projects);

  countEl.textContent = `${projects.length} fichier${projects.length > 1 ? "s" : ""}`;

  if (!projects.length) {
    container.className = "";
    container.innerHTML = `<div class="panel projects-no-results">Aucun fichier ne correspond à cette recherche.</div>`;
    return;
  }

  const flatView = filters.tool !== "all" || searchQuery.trim();
  if (flatView) {
    container.className = projectsViewMode === "card" ? "projects-grid" : "projects-list";
    container.innerHTML = projects.map((p) => (projectsViewMode === "card" ? projectCardHtml(p) : projectRowHtml(p))).join("");
    return;
  }

  const byTool = {};
  projects.forEach((p) => { (byTool[p.tool] = byTool[p.tool] || []).push(p); });
  const toolOrder = Object.keys(byTool).sort((a, b) => {
    const priority = ["upload", "studio_chain"];
    const pa = priority.indexOf(a), pb = priority.indexOf(b);
    if (pa !== -1 || pb !== -1) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
    return toolLabelFor(a).localeCompare(toolLabelFor(b));
  });

  container.className = "projects-sections";
  container.innerHTML =
    renderSection("Récents", projects.slice(0, 10), "recents") +
    toolOrder.map((tool) => renderSection(toolLabelFor(tool), byTool[tool], tool)).join("");
  wireSectionToggles();
}

function setProjectsViewMode(mode) {
  projectsViewMode = mode;
  localStorage.setItem("ss_view_mode", mode);
  document.querySelectorAll("#viewToggle .view-toggle-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === mode);
  });
  renderProjects();
}

document.querySelectorAll("#viewToggle .view-toggle-btn").forEach((b) => {
  b.classList.toggle("active", b.dataset.view === projectsViewMode);
  b.addEventListener("click", () => setProjectsViewMode(b.dataset.view));
});

document.getElementById("projectsSearch").addEventListener("input", (e) => {
  searchQuery = e.target.value;
  renderProjects();
});

/* ---------- Filtres en pilules déroulantes ---------- */

function buildToolFilterMenu() {
  const counts = {};
  allProjects.forEach((p) => { counts[p.tool] = (counts[p.tool] || 0) + 1; });
  const priority = ["upload", "studio_chain"];
  const tools = Object.keys(counts).sort((a, b) => {
    const pa = priority.indexOf(a), pb = priority.indexOf(b);
    if (pa !== -1 || pb !== -1) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
    return toolLabelFor(a).localeCompare(toolLabelFor(b));
  });

  const menu = document.querySelector('.filter-dropdown[data-filter="tool"] .filter-dd-menu');
  menu.innerHTML = [
    `<button type="button" class="filter-dd-item active" data-value="all">Tous <span class="count">${allProjects.length}</span></button>`,
    ...tools.map((tool) => `<button type="button" class="filter-dd-item" data-value="${tool}">${toolLabelFor(tool)} <span class="count">${counts[tool]}</span></button>`),
  ].join("");
}

function closeAllFilterMenus() {
  document.querySelectorAll(".filter-dropdown").forEach((dd) => {
    dd.classList.remove("open");
    dd.querySelector(".filter-dd-menu").hidden = true;
  });
}

function initFilterDropdowns() {
  document.querySelectorAll(".filter-dropdown").forEach((dd) => {
    const name = dd.dataset.filter;
    const btn = dd.querySelector(".filter-dd-btn");
    const menu = dd.querySelector(".filter-dd-menu");

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = menu.hidden;
      closeAllFilterMenus();
      if (willOpen) { dd.classList.add("open"); menu.hidden = false; }
    });

    menu.addEventListener("click", (e) => {
      const item = e.target.closest(".filter-dd-item");
      if (!item) return;
      filters[name] = item.dataset.value;
      menu.querySelectorAll(".filter-dd-item").forEach((i) => i.classList.toggle("active", i === item));
      dd.classList.toggle("filter-active", !isDefaultFilter(name, item.dataset.value));
      closeAllFilterMenus();
      renderProjects();
    });
  });

  document.addEventListener("click", closeAllFilterMenus);
}

function isDefaultFilter(name, value) {
  return (name === "tool" && value === "all") || (name === "type" && value === "all") || (name === "sort" && value === "new");
}

initFilterDropdowns();

/* ---------- Menu "⋯" et modal de détails d'une carte ---------- */

function closeAllCardMenus() {
  document.querySelectorAll(".project-card-menu").forEach((m) => { m.hidden = true; });
}

function handleCardAction(action, id) {
  const record = allProjects.find((p) => p.id === id);
  if (!record) return;
  if (action === "download") {
    const a = document.createElement("a");
    a.href = `/api/projects/${encodeURIComponent(id)}/download`;
    a.download = record.output_name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else if (action === "open-studio") {
    window.location.href = `/studio?project=${encodeURIComponent(id)}`;
  } else if (action === "delete") {
    deleteProject(id);
  }
}

function deleteProject(id) {
  const record = allProjects.find((p) => p.id === id);
  if (!record) return;
  if (!confirm(`Supprimer définitivement « ${record.output_name} » ? Cette action est irréversible.`)) return;
  fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" })
    .then((r) => {
      if (!r.ok) throw new Error();
      allProjects = allProjects.filter((p) => p.id !== id);
      buildToolFilterMenu();
      renderProjects();
      closeDetailsModal();
    })
    .catch(() => alert("Erreur lors de la suppression."));
}

document.getElementById("projectsContainer").addEventListener("click", (e) => {
  const menuBtn = e.target.closest(".project-card-menu-btn");
  if (menuBtn) {
    e.stopPropagation();
    const menu = menuBtn.nextElementSibling;
    const willOpen = menu.hidden;
    closeAllCardMenus();
    if (willOpen) menu.hidden = false;
    return;
  }
  const menuItem = e.target.closest(".project-card-menu-item");
  if (menuItem) {
    e.stopPropagation();
    closeAllCardMenus();
    handleCardAction(menuItem.dataset.action, menuItem.closest(".project-grid-card").dataset.id);
    return;
  }
  const card = e.target.closest(".project-grid-card");
  if (card) openDetailsModal(card.dataset.id);
});

document.addEventListener("click", closeAllCardMenus);

const detailsModal = document.getElementById("projectDetailsModal");
const detailsTitle = document.getElementById("detailsTitle");
const detailsPreview = document.getElementById("detailsPreview");
const detailsInfo = document.getElementById("detailsInfo");
const detailsDownload = document.getElementById("detailsDownload");
const detailsOpenStudio = document.getElementById("detailsOpenStudio");
const detailsDelete = document.getElementById("detailsDelete");
const detailsClose = document.getElementById("detailsClose");

function openDetailsModal(id) {
  const record = allProjects.find((p) => p.id === id);
  if (!record) return;
  const src = `/api/projects/${encodeURIComponent(id)}/download`;

  detailsTitle.textContent = record.output_name;
  detailsPreview.innerHTML = record.media_type === "audio"
    ? `<audio controls src="${src}"></audio>`
    : `<video controls src="${src}"></video>`;

  const rows = [
    ["Outil", record.tool_label],
    ["Modifié", record.created_at.slice(0, 16).replace("T", " ")],
    ["Taille", formatBytesCommon(record.output_size)],
  ];
  const duration = formatDurationCommon(record.duration);
  if (duration) rows.push(["Durée", duration]);
  if (record.width && record.height) rows.push(["Résolution", `${record.width}×${record.height}`]);
  if (!record.is_source) rows.push(["Fichier d'origine", record.input_name]);
  detailsInfo.innerHTML = rows.map(([k, v]) => `<div class="project-details-row"><dt>${k}</dt><dd>${v}</dd></div>`).join("");

  detailsDownload.href = src;
  detailsDownload.download = record.output_name;
  detailsOpenStudio.onclick = () => handleCardAction("open-studio", id);
  detailsDelete.onclick = () => deleteProject(id);

  detailsModal.hidden = false;
  void detailsModal.offsetWidth;
  detailsModal.classList.add("open");
}

function closeDetailsModal() {
  if (detailsModal.hidden) return;
  detailsModal.classList.remove("open");
  detailsModal.addEventListener("transitionend", function onEnd(e) {
    if (e.target !== detailsModal) return;
    detailsModal.removeEventListener("transitionend", onEnd);
    detailsModal.hidden = true;
    detailsPreview.innerHTML = ""; // stoppe la lecture en cours
  });
}

detailsClose.addEventListener("click", closeDetailsModal);
detailsModal.addEventListener("click", (e) => { if (e.target === detailsModal) closeDetailsModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !detailsModal.hidden) closeDetailsModal(); });

fetch("/api/projects")
  .then((r) => r.json())
  .then((data) => {
    allProjects = data;
    buildToolFilterMenu();
    renderProjects();
  });
