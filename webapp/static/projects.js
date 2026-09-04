let allProjects = [];
let projectsViewMode = localStorage.getItem("ss_view_mode") || "list";
let activeTool = "all";
let searchQuery = "";

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

function filteredProjects() {
  const q = searchQuery.trim().toLowerCase();
  return allProjects.filter((p) => {
    if (activeTool !== "all" && p.tool !== activeTool) return false;
    if (!q) return true;
    return (p.output_name || "").toLowerCase().includes(q) || (p.input_name || "").toLowerCase().includes(q);
  });
}

function renderProjects() {
  const container = document.getElementById("projectsContainer");

  if (!allProjects.length) {
    container.className = "";
    container.innerHTML = `<div class="panel projects-empty"><p>Aucun projet pour le moment. Les fichiers traités via les outils apparaîtront ici.</p></div>`;
    return;
  }

  const projects = filteredProjects();
  if (!projects.length) {
    container.className = "";
    container.innerHTML = `<div class="panel projects-no-results">Aucun fichier ne correspond à cette recherche.</div>`;
    return;
  }

  container.className = projectsViewMode === "card" ? "projects-grid" : "projects-list";
  container.innerHTML = projects.map((p) => (projectsViewMode === "card" ? projectCardHtml(p) : projectRowHtml(p))).join("");
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

/* ---------- Onglets par outil ---------- */

// "Importé" et "Studio" en premier (les sources les plus courantes), le reste des outils
// triés alphabétiquement par leur libellé plutôt que par ordre d'apparition arbitraire.
const TOOL_TAB_PRIORITY = ["upload", "studio_chain"];

function toolLabelFor(tool) {
  const record = allProjects.find((p) => p.tool === tool);
  return (record && record.tool_label) || tool;
}

function buildTabs() {
  const counts = {};
  allProjects.forEach((p) => { counts[p.tool] = (counts[p.tool] || 0) + 1; });
fetch("/api/projects")
  .then((r) => r.json())
  .then((data) => {
    allProjects = data;
    renderProjects();
  });
