// Prépare vendor/ffmpeg/ : le dossier unique d'où l'app lit ffmpeg et ffprobe, en développement
// comme une fois empaquetée. ffmpeg vient de ffmpeg-static ; ffprobe est téléchargé depuis la même
// release, pour avoir la même build et une version native (ffprobe-static fournit une build x86_64
// ancienne sur macOS Apple Silicon).
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ext = process.platform === "win32" ? ".exe" : "";
const dest = path.join(__dirname, "..", "vendor", "ffmpeg");
const ffmpegPkg = require("ffmpeg-static/package.json");
const releaseTag = ffmpegPkg["ffmpeg-static"]["binary-release-tag"];
const stampFile = path.join(dest, ".release");

async function main() {
  fs.mkdirSync(dest, { recursive: true });
  const ffmpegTarget = path.join(dest, "ffmpeg" + ext);
  const ffprobeTarget = path.join(dest, "ffprobe" + ext);
  const stamp = `${releaseTag} ${process.platform}-${process.arch}`;

  if (fs.existsSync(ffmpegTarget) && fs.existsSync(ffprobeTarget)
      && fs.existsSync(stampFile) && fs.readFileSync(stampFile, "utf8") === stamp) {
    console.log(`[vendor-ffmpeg] déjà à jour (${stamp})`);
    return;
  }

  const ffmpegSrc = require("ffmpeg-static");
  if (!ffmpegSrc || !fs.existsSync(ffmpegSrc)) {
    throw new Error(`ffmpeg-static n'a pas fourni de binaire pour ${process.platform}-${process.arch}`);
  }
  fs.copyFileSync(ffmpegSrc, ffmpegTarget);
  fs.chmodSync(ffmpegTarget, 0o755);
  console.log(`[vendor-ffmpeg] ffmpeg -> ${ffmpegTarget}`);

  const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/${releaseTag}/ffprobe-${process.platform}-${process.arch}.gz`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`téléchargement de ffprobe impossible (${res.status}) : ${url}`);
  fs.writeFileSync(ffprobeTarget, zlib.gunzipSync(Buffer.from(await res.arrayBuffer())));
  fs.chmodSync(ffprobeTarget, 0o755);
  console.log(`[vendor-ffmpeg] ffprobe -> ${ffprobeTarget}`);

  fs.writeFileSync(stampFile, stamp);
}

main().catch((err) => {
  console.error(`[vendor-ffmpeg] ${err.message}`);
  process.exit(1);
});
