let allProjects = [];
let projectsViewMode = localStorage.getItem("ss_view_mode") || "list";
let searchQuery = "";
let filters = { tool: "all", type: "all", sort: "new" };
const collapsedSections = new Set();

const CHEVRON_ICON = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>`;

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
    <div class="project-grid-card">
      <div class="project-grid-thumb">${thumbHtmlCommon(p)}${durationBadgeCommon(p)}</div>
      <div class="project-grid-name" title="${title}">${p.output_name}</div>
      <div class="project-grid-meta">${metaLineCommon(p)}</div>
      <a class="btn-download btn-download-block" href="/api/projects/${p.id}/download" download>${ICONS.download} Télécharger</a>
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

fetch("/api/projects")
  .then((r) => r.json())
  .then((data) => {
    allProjects = data;
    buildToolFilterMenu();
    renderProjects();
  });
