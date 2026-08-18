const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const videoStage = document.getElementById("videoStage");
const preview = document.getElementById("preview");
const info = document.getElementById("info");
const status = document.getElementById("status");
const pickProjectLink = document.getElementById("pickProjectLink");
const actionsSection = document.getElementById("actionsSection");
const applyBtn = document.getElementById("applyBtn");

let selectedFile = null;
let selectedAction = null;

const TRANSFORMS = {
  rotate_90_cw: "rotate(90deg)",
  rotate_90_ccw: "rotate(-90deg)",
  rotate_180: "rotate(180deg)",
  flip_horizontal: "scaleX(-1)",
  flip_vertical: "scaleY(-1)",
};

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
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function secondsToTimestamp(totalSeconds) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function applyPreviewTransform(action) {
  if (!action) {
    preview.style.transform = "";
    return;
  }

  let transform = TRANSFORMS[action];

  if (action === "rotate_90_cw" || action === "rotate_90_ccw") {
    // Une rotation 90° échange largeur/hauteur : on réduit l'échelle pour que
    // la vidéo pivotée tienne dans son propre conteneur sans déborder.
    const { width, height } = preview.getBoundingClientRect();
    const fitScale = Math.min(width / height, height / width);
    transform += ` scale(${fitScale})`;
  }

  preview.style.transform = transform;
}

function handleFile(file) {
  selectedFile = file;
  selectedAction = null;
  status.textContent = "";
  status.className = "status";
  preview.style.transform = "";
  document.querySelectorAll(".orientation-btn").forEach((b) => b.classList.remove("active"));

  const url = URL.createObjectURL(file);
  preview.src = url;
  videoStage.hidden = false;
  dropzone.hidden = true;
  actionsSection.hidden = false;

  preview.onloadedmetadata = () => {
    info.innerHTML = `
      <div><span>Nom du fichier</span><span>${file.name}</span></div>
      <div><span>Durée</span><span>${secondsToTimestamp(preview.duration)}</span></div>
      <div><span>Taille</span><span>${formatBytes(file.size)}</span></div>
      <div><span>Résolution</span><span>${preview.videoWidth} x ${preview.videoHeight}</span></div>
    `;
  };

  dropzone.querySelector(".dropzone-title").textContent = file.name;
}

document.querySelectorAll(".orientation-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const wasActive = btn.classList.contains("active");
    document.querySelectorAll(".orientation-btn").forEach((b) => b.classList.remove("active"));

    selectedAction = wasActive ? null : btn.dataset.action;
    if (!wasActive) btn.classList.add("active");
    applyPreviewTransform(selectedAction);

    applyBtn.disabled = !selectedFile || !selectedAction;
  });
});

applyBtn.addEventListener("click", async () => {
  if (!selectedFile || !selectedAction) return;

  applyBtn.disabled = true;
  status.className = "status";
  status.textContent = "Traitement en cours...";

  const formData = new FormData();
  formData.append("video", selectedFile);
  formData.append("action", selectedAction);

  try {
    const res = await fetch("/api/orientation", { method: "POST", body: formData });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Erreur inconnue");
    }

    const blob = await res.blob();
    const stem = selectedFile.name.replace(/\.[^/.]+$/, "");
    const ext = selectedFile.name.split(".").pop();

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${stem}_orientation.${ext}`;
    a.click();

    status.textContent = "Orientation modifiée avec succès.";
    status.className = "status success";
  } catch (e) {
    status.textContent = `Erreur : ${e.message}`;
    status.className = "status error";
  } finally {
    applyBtn.disabled = false;
  }
});
