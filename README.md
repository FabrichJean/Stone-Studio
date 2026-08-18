# Stone Studio

Studio de montage de contenu — une collection d'outils Python, chacun dédié à une tâche précise.

## Prérequis

- Python 3.9+
- [ffmpeg](https://ffmpeg.org/) installé et disponible dans le `PATH`

Vérifier :

```bash
ffmpeg -version
python3 --version
```

## Structure du projet

```
Stone Studio/
├── tools/
│   ├── extract_audio/
│   │   └── extract_audio.py   # Extraction audio depuis une vidéo
│   └── trim_media/
│       └── trim_media.py      # Découpage d'un segment audio/vidéo
├── webapp/                    # Client web (FastAPI)
│   ├── main.py
│   ├── templates/
│   └── static/
├── uploads/                   # Fichiers temporaires uploadés
└── output/                    # Sorties générées
```

Chaque nouvel outil vit dans son propre dossier sous `tools/`, avec un module Python réutilisable (logique métier) importé à la fois par le CLI et par le client web.

## Client web

Interface graphique servie par FastAPI, reprenant les outils du dossier `tools/`.

```bash
cd "Stone Studio"
.venv/bin/uvicorn webapp.main:app --reload --port 8000
```

Puis ouvrir http://127.0.0.1:8000

## Outils

### extract_audio — Extraire l'audio d'une vidéo

Extrait la piste audio d'un fichier vidéo via ffmpeg.

**Usage**

```bash
python3 tools/extract_audio/extract_audio.py <video>
python3 tools/extract_audio/extract_audio.py <video> -f wav -o sortie.wav
```

**Options**

| Option | Description | Défaut |
|---|---|---|
| `video` | Chemin du fichier vidéo source (obligatoire) | — |
| `-f`, `--format` | Format de sortie : `mp3`, `wav`, `aac`, `flac` | `mp3` |
| `-o`, `--output` | Chemin du fichier audio de sortie | `<video>.<format>` |

**Exemples**

```bash
# MP3 (défaut), sortie à côté de la vidéo
python3 tools/extract_audio/extract_audio.py ma_video.mp4

# WAV avec chemin de sortie personnalisé
python3 tools/extract_audio/extract_audio.py ma_video.mp4 -f wav -o output/audio.wav
```

### trim_media — Découper un segment audio/vidéo

Extrait un segment (début/fin) d'un fichier audio ou vidéo via ffmpeg, sans réencodage.

**Usage**

```bash
python3 tools/trim_media/trim_media.py <fichier> -s <début> -e <fin>
python3 tools/trim_media/trim_media.py <fichier> -s <début> -d <durée>
```

**Options**

| Option | Description | Défaut |
|---|---|---|
| `media` | Chemin du fichier source (obligatoire) | — |
| `-s`, `--start` | Temps de début (HH:MM:SS) | `00:00:00` |
| `-e`, `--end` | Temps de fin (HH:MM:SS) | — |
| `-d`, `--duration` | Durée du segment (HH:MM:SS, alternative à `--end`) | — |
| `-o`, `--output` | Chemin du fichier de sortie | `<fichier>_trim.<ext>` |

**Exemples**

```bash
# Segment de 10s à 25s
python3 tools/trim_media/trim_media.py ma_video.mp4 -s 00:00:10 -e 00:00:25

# 5 secondes à partir de 1min
python3 tools/trim_media/trim_media.py audio.mp3 -s 00:01:00 -d 00:00:05
```

> Le découpage réencode le segment (H.264/AAC pour la vidéo) afin de couper précisément à la frame demandée, sans figeage au démarrage lié à un point de coupe hors keyframe.

## Ajouter un nouvel outil

1. Créer un dossier `tools/<nom_outil>/`
2. Ajouter le script Python (CLI via `argparse`, comme `extract_audio.py`)
3. Documenter l'outil dans ce README
