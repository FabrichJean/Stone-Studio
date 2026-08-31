const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const sidePanel = document.getElementById("sidePanel");
const preview = document.getElementById("preview");
const info = document.getElementById("info");
const extractBtn = document.getElementById("extractBtn");
const status = document.getElementById("status");
const pickProjectLink = document.getElementById("pickProjectLink");
const progressWrap = document.getElementById("progressWrap");
const progressFill = document.getElementById("progressFill");
const progressLabel = document.getElementById("progressLabel");
const downloadBtn = document.getElementById("downloadBtn");

let selectedFile = null;
let pendingDownload = null;

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

function formatBytes(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function handleFile(file) {
  selectedFile = file;
  extractBtn.disabled = false;
  status.textContent = "";
  status.className = "status";
  progressWrap.hidden = true;
  downloadBtn.hidden = true;
  pendingDownload = null;

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
      <div><span>Taille</span><span>${formatBytes(file.size)}</span></div>
      <div><span>Résolution</span><span>${preview.videoWidth} x ${preview.videoHeight}</span></div>
    `;
  };

  dropzone.querySelector(".dropzone-title").textContent = file.name;
}

function setProgress(percent, label) {
  progressWrap.hidden = false;
  progressFill.style.width = `${percent}%`;
  progressLabel.textContent = label;
}

function pollExtractProgress(jobId) {
  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/extract-audio/${jobId}/progress`);
        if (!res.ok) throw new Error("Tâche introuvable");
        const job = await res.json();

        if (job.status === "processing") {
          setProgress(job.percent, `Extraction en cours... ${job.percent.toFixed(0)}%`);
        } else if (job.status === "done") {
          clearInterval(interval);
          setProgress(100, "Extraction terminée.");
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

extractBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  extractBtn.disabled = true;
  downloadBtn.hidden = true;
  pendingDownload = null;
  status.className = "status";
  status.textContent = "";
  setProgress(0, "Démarrage de l'extraction...");

  const formData = new FormData();
  formData.append("video", selectedFile);
  formData.append("format", document.getElementById("format").value);
  formData.append("bitrate", document.getElementById("bitrate").value);
  formData.append("channels", document.getElementById("channels").value);
  formData.append("sample_rate", document.getElementById("sampleRate").value);

  try {
    const startRes = await fetch("/api/extract-audio", { method: "POST", body: formData });
    if (!startRes.ok) {
      const err = await startRes.json();
      throw new Error(err.detail || "Erreur inconnue");
    }
    const { job_id } = await startRes.json();

    const job = await pollExtractProgress(job_id);

    const dlRes = await fetch(`/api/projects/${job.project_id}/download`);
    if (!dlRes.ok) throw new Error("Téléchargement impossible");
    const blob = await dlRes.blob();

    pendingDownload = { blob, name: job.output_name };
    downloadBtn.hidden = false;

    status.textContent = `Audio extrait avec succès (${formatBytes(job.output_size)}).`;
    status.className = "status success";
  } catch (e) {
    status.textContent = `Erreur : ${e.message}`;
    status.className = "status error";
    progressWrap.hidden = true;
  } finally {
    extractBtn.disabled = false;
  }
});

downloadBtn.addEventListener("click", () => {
  if (!pendingDownload) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(pendingDownload.blob);
  a.download = pendingDownload.name;
  a.click();
  URL.revokeObjectURL(a.href);
});
