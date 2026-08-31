const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const sidePanel = document.getElementById("sidePanel");
const preview = document.getElementById("preview");
const info = document.getElementById("info");
const applyBtn = document.getElementById("applyBtn");
const status = document.getElementById("status");
const pickProjectLink = document.getElementById("pickProjectLink");
const limitSize = document.getElementById("limitSize");
const maxSizeMb = document.getElementById("maxSizeMb");
const progressWrap = document.getElementById("progressWrap");
const progressFill = document.getElementById("progressFill");
const progressLabel = document.getElementById("progressLabel");

let selectedFile = null;

limitSize.addEventListener("change", () => {
  maxSizeMb.disabled = !limitSize.checked;
});

dropzone.addEventListener("click", () => fileInput.click());

pickProjectLink.addEventListener("click", (e) => {
  e.stopPropagation();
  openProjectPicker(handleFile);
});

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});

dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));

dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener("change", () => {
  if (fileInput.files.length) handleFile(fileInput.files[0]);
});

function handleFile(file) {
  selectedFile = file;
  applyBtn.disabled = false;
  status.textContent = "";
  status.className = "status";

  const url = URL.createObjectURL(file);
  preview.src = url;
  dropzone.hidden = true;
  sidePanel.hidden = false;

  preview.onloadedmetadata = () => {
    const duration = preview.duration;
    const mm = Math.floor(duration / 60).toString().padStart(2, "0");
    const ss = Math.floor(duration % 60).toString().padStart(2, "0");
    info.innerHTML = `
      <div><span>Nom du fichier</span><span>${file.name}</span></div>
      <div><span>Durée</span><span>${mm}:${ss}</span></div>
      <div><span>Résolution</span><span>${preview.videoWidth}x${preview.videoHeight}</span></div>
      <div><span>Taille</span><span>${formatBytesCommon(file.size)}</span></div>
    `;
  };

  dropzone.querySelector(".dropzone-title").textContent = file.name;
}

function setProgress(percent, label) {
  progressWrap.hidden = false;
  progressFill.style.width = `${percent}%`;
  progressLabel.textContent = label;
}

function pollProgress(jobId) {
  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/compress-media/${jobId}/progress`);
        if (!res.ok) throw new Error("Tâche introuvable");
        const job = await res.json();

        if (job.status === "processing") {
          setProgress(job.percent, `Compression en cours... ${job.percent.toFixed(0)}%`);
        } else if (job.status === "done") {
          clearInterval(interval);
          setProgress(100, "Compression terminée.");
          resolve(job);
        } else if (job.status === "error") {
          clearInterval(interval);
          reject(new Error(job.error || "Erreur inconnue"));
        }
      } catch (e) {
        clearInterval(interval);
        reject(e);
      }
    }, 600);
  });
}

applyBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  applyBtn.disabled = true;
  status.className = "status";
  status.textContent = "";
  setProgress(0, "Démarrage de la compression...");

  const formData = new FormData();
  formData.append("video", selectedFile);
  formData.append("level", document.getElementById("level").value);
  formData.append("resolution", document.getElementById("resolution").value);
  if (limitSize.checked && maxSizeMb.value) {
    formData.append("max_size_mb", maxSizeMb.value);
  }

  try {
    const startRes = await fetch("/api/compress-media", { method: "POST", body: formData });
    if (!startRes.ok) {
      const err = await startRes.json();
      throw new Error(err.detail || "Erreur inconnue");
    }
    const { job_id } = await startRes.json();

    const job = await pollProgress(job_id);

    const dlRes = await fetch(`/api/projects/${job.project_id}/download`);
    if (!dlRes.ok) throw new Error("Téléchargement impossible");
    const blob = await dlRes.blob();

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = job.output_name;
    a.click();
    URL.revokeObjectURL(a.href);

    const ratio = Math.round((1 - job.output_size / selectedFile.size) * 100);
    const change = ratio >= 0 ? `réduite de ${ratio}%` : `augmentée de ${-ratio}%`;
    status.textContent = `Compression terminée : ${formatBytesCommon(job.output_size)} (taille ${change}).`;
    status.className = "status success";
  } catch (e) {
    status.textContent = `Erreur : ${e.message}`;
    status.className = "status error";
    progressWrap.hidden = true;
  } finally {
    applyBtn.disabled = false;
  }
});
