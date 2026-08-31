const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const sidePanel = document.getElementById("sidePanel");
const preview = document.getElementById("preview");
const info = document.getElementById("info");
const applyBtn = document.getElementById("applyBtn");
const status = document.getElementById("status");
const pickProjectLink = document.getElementById("pickProjectLink");

let selectedFile = null;

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
      <div><span>Taille</span><span>${formatBytesCommon(file.size)}</span></div>
    `;
  };

  dropzone.querySelector(".dropzone-title").textContent = file.name;
}

applyBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  applyBtn.disabled = true;
  status.className = "status";
  status.textContent = "Réduction du bruit en cours...";

  const formData = new FormData();
  formData.append("media", selectedFile);
  formData.append("level", document.getElementById("level").value);
  formData.append("reduce_hum", document.getElementById("reduceHum").checked);

  try {
    const res = await fetch("/api/noise-removal", { method: "POST", body: formData });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Erreur inconnue");
    }

    const blob = await res.blob();
    const stem = selectedFile.name.replace(/\.[^/.]+$/, "");
    const ext = selectedFile.name.slice(selectedFile.name.lastIndexOf("."));

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${stem}_denoised${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);

    status.textContent = "Bruit réduit avec succès.";
    status.className = "status success";
  } catch (e) {
    status.textContent = `Erreur : ${e.message}`;
    status.className = "status error";
  } finally {
    applyBtn.disabled = false;
  }
});
