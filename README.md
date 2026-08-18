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
│   └── extract_audio/
│       └── extract_audio.py   # Extraction audio depuis une vidéo
└── output/                    # Sorties générées (facultatif)
```

Chaque nouvel outil vit dans son propre dossier sous `tools/`.

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

## Ajouter un nouvel outil

1. Créer un dossier `tools/<nom_outil>/`
2. Ajouter le script Python (CLI via `argparse`, comme `extract_audio.py`)
3. Documenter l'outil dans ce README
