const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const sidePanel = document.getElementById("sidePanel");
const preview = document.getElementById("preview");
const info = document.getElementById("info");
const extractBtn = document.getElementById("extractBtn");
const status = document.getElementById("status");

let selectedFile = null;

dropzone.addEventListener("click", () => fileInput.click());

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

extractBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  extractBtn.disabled = true;
  status.className = "status";
  status.textContent = "Extraction en cours...";

  const formData = new FormData();
  formData.append("video", selectedFile);
  formData.append("format", document.getElementById("format").value);
  formData.append("bitrate", document.getElementById("bitrate").value);
  formData.append("channels", document.getElementById("channels").value);
  formData.append("sample_rate", document.getElementById("sampleRate").value);

  try {
    const res = await fetch("/api/extract-audio", { method: "POST", body: formData });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Erreur inconnue");
    }

    const blob = await res.blob();
    const format = document.getElementById("format").value;
    const stem = selectedFile.name.replace(/\.[^/.]+$/, "");

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${stem}.${format}`;
    a.click();

    status.textContent = "Audio extrait avec succès.";
    status.className = "status success";
  } catch (e) {
    status.textContent = `Erreur : ${e.message}`;
    status.className = "status error";
  } finally {
    extractBtn.disabled = false;
  }
});
