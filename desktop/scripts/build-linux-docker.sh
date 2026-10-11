#!/usr/bin/env bash
# Construit l'AppImage Linux (x86-64) dans un conteneur Docker, depuis macOS ou Windows.
# Les sources sont copiées dans le conteneur : node_modules, ffmpeg et le serveur gelé de la
# machine hôte ne sont pas touchés. Seule l'AppImage est recopiée dans desktop/dist/.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$REPO_ROOT/desktop/dist"

docker run --rm --platform linux/amd64 \
  -v "$REPO_ROOT":/src:ro \
  -v "$REPO_ROOT/desktop/dist":/out \
  node:20-bookworm bash -euo pipefail -c '
    apt-get update -qq && apt-get install -y -qq python3-venv > /dev/null
    mkdir -p /work
    tar -C /src \
      --exclude=./.git --exclude=./.venv --exclude=./uploads --exclude=./output --exclude=./thumbnails \
      --exclude=./desktop/node_modules --exclude=./desktop/build --exclude=./desktop/dist --exclude=./desktop/vendor \
      -cf - . | tar -C /work -xf -
    cd /work
    python3 -m venv .venv
    .venv/bin/pip install -q -r desktop/requirements-build.txt
    cd desktop
    npm ci --include=dev --no-audit --no-fund
    npm run build:backend
    npx electron-builder --linux AppImage --x64 --publish never
    cp dist/*.AppImage /out/
  '

ls -lh "$REPO_ROOT"/desktop/dist/*.AppImage
