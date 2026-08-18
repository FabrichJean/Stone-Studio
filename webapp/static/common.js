function formatBytesCommon(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

async function openProjectPicker(onSelect) {
  let projects;
  try {
    const res = await fetch("/api/projects");
    projects = await res.json();
  } catch {
    alert("Impossible de charger les projets.");
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const body = projects.length
    ? projects
        .map(
          (p) => `
        <div class="picker-item" data-id="${p.id}">
          <span class="picker-icon">${p.tool_icon}</span>
          <div class="picker-info">
            <span class="picker-name">${p.output_name}</span>
            <span class="picker-meta">${p.tool_label} · ${formatBytesCommon(p.output_size)}</span>
          </div>
        </div>`
        )
        .join("")
    : `<div class="picker-empty">Aucun projet disponible pour le moment.</div>`;

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>Choisir un fichier existant</h3>
        <button class="modal-close" type="button">✕</button>
      </div>
      <div class="modal-body">${body}</div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector(".modal-close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  overlay.querySelectorAll(".picker-item").forEach((el) => {
    el.addEventListener("click", async () => {
      const record = projects.find((p) => p.id === el.dataset.id);
      el.classList.add("picker-item-loading");
      try {
        const res = await fetch(`/api/projects/${record.id}/download`);
        const blob = await res.blob();
        const file = new File([blob], record.output_name, { type: blob.type });
        close();
        onSelect(file);
      } catch {
        el.classList.remove("picker-item-loading");
        alert("Erreur lors du chargement du fichier.");
      }
    });
  });
}
