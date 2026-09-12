# Stone Studio

Studio de montage de contenu — une collection d'outils Python (chacun dédié à une tâche précise) exposés via un client web FastAPI.

## Prérequis

- Python 3.9+
- [ffmpeg](https://ffmpeg.org/) et `ffprobe` installés et disponibles dans le `PATH`

Vérifier :

```bash
ffmpeg -version
python3 --version
```

## Structure du projet

```
Stone Studio/
├── tools/
│   ├── extract_audio/       # Extraction audio depuis une vidéo
│   ├── trim_media/          # Découpage d'un segment audio/vidéo
│   ├── speed_media/         # Changement de vitesse (global ou par morceaux)
│   ├── orientation/         # Rotation, miroir, recadrage / format d'affichage
│   ├── screen_record/       # Finalisation d'un enregistrement écran ou audio brut
│   ├── noise_removal/       # Réduction du bruit de fond
│   └── compress_media/      # Compression vidéo (taille de fichier réduite)
├── webapp/                  # Client web (FastAPI)
│   ├── main.py               # Routes, jobs asynchrones, catalogue de projets
│   ├── studio_chain.py       # Enchaîne plusieurs outils (Studio) et assemble un montage
│   ├── media_utils.py        # Sondage média, miniatures, filmstrip
│   ├── templates/
│   └── static/
├── uploads/                  # Fichiers temporaires uploadés
├── output/                   # Sorties générées
├── thumbnails/                # Miniatures et filmstrips générés
└── projects.json             # Catalogue des projets (historique des traitements)
```

Chaque outil vit dans son propre dossier sous `tools/`, avec un module Python réutilisable (logique métier, indépendante de l'interface) importé à la fois par son CLI et par le client web.

## Client web

Interface graphique servie par FastAPI, reprenant tous les outils du dossier `tools/` plus un mode **Studio** pour enchaîner plusieurs traitements sur un même fichier.

```bash
cd "Stone Studio"
.venv/bin/uvicorn webapp.main:app --reload --port 8000
```

Puis ouvrir http://127.0.0.1:8000

### Pages disponibles

| Page | Route | Description |
|---|---|---|
| Studio | `/studio` | Enchaîne plusieurs outils sur un fichier (trim → vitesse → orientation → compression → suppression bruit) et exporte un montage assemblé à partir de plusieurs clips |
| Extraction audio | `/` | Extrait l'audio d'une vidéo |
| Trim media | `/trim` | Découpe un ou plusieurs segments |
| Speed | `/speed` | Change la vitesse (globale ou par morceau) |
| Orientation | `/orientation` | Rotation, miroir, recadrage, format d'affichage, zoom progressif |
| Suppression bruit | `/noise-removal` | Réduit le bruit de fond audio |
| Compression vidéo | `/compress` | Réduit la taille du fichier vidéo |
| Enregistrement écran | `/record` | Capture l'écran (avec sélection de zone) ou le micro seul, directement dans le navigateur |
| Mes projets | `/projects` | Historique des fichiers importés et générés, avec aperçu et téléchargement |

Les traitements longs (compression, trim, speed, orientation, enregistrement, studio) s'exécutent en tâche de fond avec une barre de progression suivie via polling (`/api/<outil>/{job_id}/progress`).

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
| `-b`, `--bitrate` | Bitrate audio (ex: `320k`) | — |
| `-c`, `--channels` | `mono` ou `stereo` | — |
| `-r`, `--sample-rate` | Fréquence d'échantillonnage (ex: `44100`) | — |
| `-o`, `--output` | Chemin du fichier audio de sortie | `<video>.<format>` |

**Exemples**

```bash
# MP3 (défaut), sortie à côté de la vidéo
python3 tools/extract_audio/extract_audio.py ma_video.mp4

# WAV avec chemin de sortie personnalisé
python3 tools/extract_audio/extract_audio.py ma_video.mp4 -f wav -o output/audio.wav
```

### trim_media — Découper (et combiner) des segments audio/vidéo

Extrait un segment (début/fin) d'un fichier audio ou vidéo via ffmpeg, ou découpe puis recolle plusieurs segments en un seul fichier.

**Usage**

```bash
python3 tools/trim_media/trim_media.py <fichier> -s <début> -e <fin>
python3 tools/trim_media/trim_media.py <fichier> -s <début> -d <durée>
python3 tools/trim_media/trim_media.py <fichier> --segment <début1> <fin1> --segment <début2> <fin2>
```

**Options**

| Option | Description | Défaut |
|---|---|---|
| `media` | Chemin du fichier source (obligatoire) | — |
| `-s`, `--start` | Temps de début (HH:MM:SS) | `00:00:00` |
| `-e`, `--end` | Temps de fin (HH:MM:SS, exclusif avec `-d`) | — |
| `-d`, `--duration` | Durée du segment (HH:MM:SS, alternative à `--end`) | — |
| `--segment START END` | Segment à combiner (répétable) ; si fourni, découpe et concatène tous les segments, ignore `-s`/`-e`/`-d` | — |
| `-o`, `--output` | Chemin du fichier de sortie | `<fichier>_trim.<ext>` (ou `_combined.<ext>` avec `--segment`) |

**Exemples**

```bash
# Segment de 10s à 25s
python3 tools/trim_media/trim_media.py ma_video.mp4 -s 00:00:10 -e 00:00:25

# 5 secondes à partir de 1min
python3 tools/trim_media/trim_media.py audio.mp3 -s 00:01:00 -d 00:00:05

# Recoller deux morceaux non contigus en un seul fichier
python3 tools/trim_media/trim_media.py ma_video.mp4 \
  --segment 00:00:00 00:00:05 \
  --segment 00:00:20 00:00:25
```

> Le découpage réencode le segment (H.264/AAC pour la vidéo) afin de couper précisément à la frame demandée, sans figeage au démarrage lié à un point de coupe hors keyframe.

### speed_media — Changer la vitesse d'un média

Accélère ou ralentit un fichier audio/vidéo, globalement ou morceau par morceau (vitesses différentes selon les segments, recollés ensuite).

**Usage**

```bash
python3 tools/speed_media/speed_media.py <fichier> -f <facteur>
python3 tools/speed_media/speed_media.py <fichier> --segment 00:00:00 00:00:05 2.0 --segment 00:00:05 00:00:10 0.5
```

**Options**

| Option | Description | Défaut |
|---|---|---|
| `media` | Chemin du fichier source (obligatoire) | — |
| `-f`, `--factor` | Facteur de vitesse global (ex: `1.5`, `0.5`) | `1.0` |
| `--segment START END FACTOR` | Segment avec sa propre vitesse (répétable) | — |
| `-o`, `--output` | Chemin du fichier de sortie | `<fichier>_speed.<ext>` |

**Exemples**

```bash
# Vitesse x2 sur tout le fichier
python3 tools/speed_media/speed_media.py ma_video.mp4 -f 2.0

# Deux morceaux à des vitesses différentes, recollés
python3 tools/speed_media/speed_media.py ma_video.mp4 \
  --segment 00:00:00 00:00:05 2.0 \
  --segment 00:00:05 00:00:10 0.5
```

### orientation — Rotation, miroir et recadrage

Fait pivoter, retourne en miroir ou recadre une vidéo vers un format d'affichage donné, globalement ou par morceau.

**Usage**

```bash
python3 tools/orientation/orientation.py <video> -a rotate_90_cw
python3 tools/orientation/orientation.py <video> --aspect portrait_9_16
```

**Options**

| Option | Description | Défaut |
|---|---|---|
| `video` | Chemin du fichier vidéo source (obligatoire) | — |
| `-a`, `--action` | Action d'orientation (répétable) : `rotate_90_cw`, `rotate_90_ccw`, `rotate_180`, `flip_horizontal`, `flip_vertical` | — |
| `--aspect` | Format d'affichage global : `landscape_16_9`, `portrait_9_16`, `square_1_1`, `portrait_4_5` | — |
| `--aspect-pos` | Position du recadrage le long de l'axe rogné (0..1) | `0.5` |
| `--segment START END ACTIONS` | Segment avec ses propres actions, séparées par des virgules (répétable) | — |
| `-o`, `--output` | Chemin du fichier de sortie | `<video>_orientation.<ext>` |

**Exemples**

```bash
# Rotation 90° horaire puis miroir horizontal
python3 tools/orientation/orientation.py ma_video.mp4 -a rotate_90_cw -a flip_horizontal

# Recadrage au format story (9:16)
python3 tools/orientation/orientation.py ma_video.mp4 --aspect portrait_9_16
```

### noise_removal — Réduire le bruit de fond

Réduit le bruit de fond (souffle, ventilation, foule) et/ou le ronflement secteur d'un fichier audio ou vidéo, via le filtre ffmpeg `afftdn`. Pour une vidéo, seule la piste audio est réencodée : la vidéo est copiée telle quelle.

**Usage**

```bash
python3 tools/noise_removal/noise_removal.py <fichier> -l strong
python3 tools/noise_removal/noise_removal.py <fichier> --reduce-hum
```

**Options**

| Option | Description | Défaut |
|---|---|---|
| `media` | Chemin du fichier source (obligatoire) | — |
| `-l`, `--level` | Intensité : `light`, `medium`, `strong` | `medium` |
| `--reduce-hum` | Coupe aussi le ronflement secteur / basses fréquences (< 100 Hz) | désactivé |
| `-o`, `--output` | Chemin du fichier de sortie | `<fichier>_denoised.<ext>` |

**Exemples**

```bash
# Réduction moyenne
python3 tools/noise_removal/noise_removal.py interview.mp4

# Réduction forte + coupe du ronflement secteur
python3 tools/noise_removal/noise_removal.py interview.mp4 -l strong --reduce-hum
```

### compress_media — Compresser une vidéo

Réduit la taille d'un fichier vidéo via l'encodeur H.264, soit par un niveau de qualité, soit en visant une taille de fichier précise (calcul automatique du bitrate).

**Usage**

```bash
python3 tools/compress_media/compress_media.py <video> -l strong
python3 tools/compress_media/compress_media.py <video> -s 25 -r 720p
```

**Options**

| Option | Description | Défaut |
|---|---|---|
| `media` | Chemin du fichier vidéo source (obligatoire) | — |
| `-l`, `--level` | Intensité : `light`, `medium`, `strong` | `medium` |
| `-r`, `--resolution` | Résolution cible : `original`, `1080p`, `720p`, `480p` | `original` |
| `-s`, `--max-size` | Taille maximale visée, en méga-octets (ignore `--level` si fourni) | — |
| `-o`, `--output` | Chemin du fichier de sortie | `<video>_compressed.<ext>` |

**Exemples**

```bash
# Compression forte, résolution inchangée
python3 tools/compress_media/compress_media.py ma_video.mp4 -l strong

# Viser 25 Mo en 720p
python3 tools/compress_media/compress_media.py ma_video.mp4 -s 25 -r 720p
```

### screen_record — Finaliser un enregistrement écran ou audio

Ne capture rien lui-même : le navigateur enregistre l'écran (ou le micro seul) via `MediaRecorder` et produit un fichier « brut » sans durée fiable dans son en-tête. Cet outil le réencode en fichier propre et navigable, avec suivi de progression.

**Usage**

```bash
python3 tools/screen_record/screen_record.py capture_brute.webm -f mp4
python3 tools/screen_record/screen_record.py capture_micro.webm -f mp3
```

**Options**

| Option | Description | Défaut |
|---|---|---|
| `recording` | Fichier brut issu du navigateur (obligatoire) | — |
| `-f`, `--format` | Format de sortie — vidéo : `mp4`, `webm` ; audio seul : `mp3`, `wav`, `m4a` | `mp4` |
| `-o`, `--output` | Chemin du fichier de sortie | `<recording>.<format>` |

Depuis la page web `/record`, un bascule **Écran / Audio seul** permet d'enregistrer uniquement le micro (sans partage d'écran) ; le format proposé s'adapte automatiquement.

## Studio — enchaîner plusieurs outils

La page `/studio` applique plusieurs traitements en séquence sur un même fichier (la sortie de chaque étape devient l'entrée de la suivante) et peut aussi assembler plusieurs clips bout à bout en un montage final. Cette logique vit dans `webapp/studio_chain.py`, qui réutilise directement les fonctions des outils ci-dessus — il n'y a pas de CLI dédiée, uniquement l'interface web.

## Ajouter un nouvel outil

1. Créer un dossier `tools/<nom_outil>/`
2. Ajouter le script Python (CLI via `argparse`, comme `extract_audio.py`)
3. Documenter l'outil dans ce README
4. Pour l'exposer dans le client web : l'importer dans `webapp/main.py`, ajouter une route/template/JS suivant le patron des outils existants, et l'ajouter à `TOOL_LABELS` / `PAGE_TITLES`
