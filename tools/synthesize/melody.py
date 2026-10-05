"""Transforme un audio ou une vidéo existante en mélodie synthétique — pas juste un habillage du
signal d'origine (comme le visualiseur), mais une analyse réelle : hauteur dominante, énergie et
tempo sont extraits image par image, puis quantifiés sur une gamme et une grille rythmique
choisies pour que le résultat sonne comme une mélodie, jamais comme du bruit.

Aucune bibliothèque d'analyse audio externe (pas de librosa/scipy) : tout est fait à la main avec
numpy (autocorrélation pour la hauteur, flux d'énergie pour le tempo) et ffmpeg pour l'I/O."""

from __future__ import annotations

import math
import subprocess
import wave
from pathlib import Path
from typing import Callable

import numpy as np

ProgressCallback = Callable[[float], None]

SAMPLE_RATE = 22050
FRAME_SIZE = 2048
HOP = 512
FMIN, FMAX = 70.0, 1000.0
MAX_ANALYSIS_SECONDS = 180.0
BAR_CELLS = 8  # grille ~croche : 8 cellules = 4 temps = une mesure en 4/4

BASS_TIMBRE = {
    "harmonics": [1.0, 0.4, 0.15], "detune": [0, 0, 0],
    "attack": 0.004, "decay": 0.12, "sustain": 0.55, "release": 0.12, "decay_curve": 2.0, "vibrato": 0.0,
}

MELODY_LAYERS = {
    "bass": {"label": "Basse", "description": "Racine et quinte de l'accord, une octave sous la mélodie."},
    "pad": {"label": "Accords", "description": "Nappe d'accords tenue — l'habillage harmonique."},
    "drums": {"label": "Batterie", "description": "Charleston et grosse caisse, pour sentir le tempo."},
}

MELODY_KEYS = {
    "C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5,
    "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11,
}

MELODY_SCALES = {
    "major": {"label": "Majeure", "description": "Lumineuse, résolue — le son le plus \"pop\".", "intervals": {0, 2, 4, 5, 7, 9, 11}},
    "minor": {"label": "Mineure naturelle", "description": "Plus sombre, mélancolique.", "intervals": {0, 2, 3, 5, 7, 8, 10}},
    "pentatonic_major": {"label": "Pentatonique majeure", "description": "Sans demi-ton — impossible de jouer une fausse note.", "intervals": {0, 2, 4, 7, 9}},
    "pentatonic_minor": {"label": "Pentatonique mineure", "description": "Le squelette du blues et du rock.", "intervals": {0, 3, 5, 7, 10}},
    "blues": {"label": "Blues", "description": "Pentatonique mineure + la \"blue note\".", "intervals": {0, 3, 5, 6, 7, 10}},
}

MELODY_TIMBRES = {
    "piano": {
        "label": "Piano synthé", "description": "Attaque nette, résonance qui s'éteint naturellement.",
        "harmonics": [1.0, 0.55, 0.3, 0.18, 0.1, 0.05], "detune": [0, 0, 0, 0, 0, 0],
        "attack": 0.004, "decay": 0.35, "sustain": 0.25, "release": 0.35, "decay_curve": 3.2, "vibrato": 0.0,
    },
    "pluck": {
        "label": "Pincé", "description": "Court et sec, façon corde pincée.",
        "harmonics": [1.0, 0.45, 0.18, 0.08], "detune": [0, 0, 0, 0],
        "attack": 0.002, "decay": 0.18, "sustain": 0.05, "release": 0.15, "decay_curve": 6.0, "vibrato": 0.0,
    },
    "pad": {
        "label": "Nappe", "description": "Entrée douce, tenue longue, chaude.",
        "harmonics": [1.0, 0.5, 0.35, 0.2, 0.12], "detune": [0, 0.15, -0.15, 0.25, -0.25],
        "attack": 0.18, "decay": 0.2, "sustain": 0.75, "release": 0.5, "decay_curve": 0.8, "vibrato": 4.5,
    },
    "bell": {
        "label": "Cloche", "description": "Partiels légèrement désaccordés, longue traîne.",
        "harmonics": [1.0, 0.6, 0.35, 0.22, 0.14], "detune": [0, 4.0, 7.0, 11.5, 17.0],
        "attack": 0.002, "decay": 0.6, "sustain": 0.05, "release": 0.9, "decay_curve": 2.2, "vibrato": 0.0,
    },
    "lead": {
        "label": "Lead", "description": "Riche en harmoniques, façon synthé analogique.",
        "harmonics": [1.0, 0.5, 0.33, 0.25, 0.2, 0.16, 0.14, 0.12], "detune": [0, 0, 0, 0, 0, 0, 0, 0],
        "attack": 0.02, "decay": 0.1, "sustain": 0.7, "release": 0.25, "decay_curve": 1.0, "vibrato": 5.5,
    },
}


class MelodyError(RuntimeError):
    pass


def _has_audio_stream(path: Path) -> bool:
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "a",
        "-show_entries", "stream=index", "-of", "csv=p=0", str(path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return bool(result.stdout.strip())


def _extract_mono_pcm(source_path: Path, workdir: Path) -> np.ndarray:
    if not _has_audio_stream(source_path):
        raise MelodyError("Ce fichier n'a pas de piste audio à analyser.")
    wav_path = workdir / "melody_source.wav"
    cmd = [
        "ffmpeg", "-y", "-i", str(source_path),
        "-t", str(MAX_ANALYSIS_SECONDS),
        "-ac", "1", "-ar", str(SAMPLE_RATE), "-vn",
        "-f", "wav", str(wav_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 or not wav_path.exists():
        raise MelodyError("Impossible d'extraire l'audio de la source pour l'analyser.")
    with wave.open(str(wav_path), "rb") as wf:
        raw = wf.readframes(wf.getnframes())
        sr = wf.getframerate()
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float64) / 32768.0
    wav_path.unlink(missing_ok=True)
    if sr != SAMPLE_RATE or samples.size == 0:
        raise MelodyError("Analyse audio impossible sur ce fichier.")
    return samples


def _frame_signal(samples: np.ndarray) -> np.ndarray:
    n_frames = max(1, 1 + (len(samples) - FRAME_SIZE) // HOP)
    frames = np.zeros((n_frames, FRAME_SIZE))
    for i in range(n_frames):
        start = i * HOP
        chunk = samples[start:start + FRAME_SIZE]
        frames[i, :len(chunk)] = chunk
    return frames


def _detect_pitch(frame: np.ndarray) -> tuple[float | None, float]:
    windowed = (frame - frame.mean()) * np.hanning(len(frame))
    energy = float(np.sqrt(np.mean(windowed ** 2)))
    if energy < 1e-4:
        return None, energy
    corr = np.correlate(windowed, windowed, mode="full")
    corr = corr[len(corr) // 2:]
    if corr[0] <= 0:
        return None, energy
    min_lag = int(SAMPLE_RATE / FMAX)
    max_lag = min(int(SAMPLE_RATE / FMIN), len(corr) - 1)
    if min_lag >= max_lag:
        return None, energy
    segment = corr[min_lag:max_lag]
    peak_idx = int(np.argmax(segment)) + min_lag
    confidence = corr[peak_idx] / corr[0]
    if confidence < 0.35:
        return None, energy
    return SAMPLE_RATE / peak_idx, energy


def _estimate_grid_seconds(energies: np.ndarray) -> float:
    hop_time = HOP / SAMPLE_RATE
    flux = np.diff(energies, prepend=energies[0])
    flux[flux < 0] = 0.0
    if flux.size < 8 or np.allclose(flux, 0):
        return 0.25
    flux = flux - flux.mean()
    corr = np.correlate(flux, flux, mode="full")
    corr = corr[len(corr) // 2:]
    lo_lag = max(1, int(0.333 / hop_time))
    hi_lag = min(len(corr) - 1, int(1.0 / hop_time))
    if lo_lag >= hi_lag:
        return 0.25
    segment = corr[lo_lag:hi_lag]
    beat_period = (int(np.argmax(segment)) + lo_lag) * hop_time
    grid = beat_period / 2
    return max(0.1, min(grid, 0.5))


def _freq_to_midi(freq: float) -> float:
    return 69.0 + 12.0 * math.log2(freq / 440.0)


def _midi_to_freq(midi: float) -> float:
    return 440.0 * 2.0 ** ((midi - 69.0) / 12.0)


def _nearest_scale_midi(midi: float, key_pc: int, intervals: set[int]) -> int:
    lo, hi = int(midi) - 14, int(midi) + 14
    best, best_dist = 60, 1e9
    for m in range(lo, hi + 1):
        if (m - key_pc) % 12 in intervals:
            d = abs(m - midi)
            if d < best_dist:
                best_dist, best = d, m
    return best


def _clamp_register(midi: int, lo: int = 55, hi: int = 81) -> int:
    while midi < lo:
        midi += 12
    while midi > hi:
        midi -= 12
    return midi


def _build_note_events(samples: np.ndarray, key: str, scale: str) -> tuple[list[dict], float]:
    frames = _frame_signal(samples)
    pitches: list[float | None] = []
    energies = np.zeros(len(frames))
    for i, frame in enumerate(frames):
        f0, energy = _detect_pitch(frame)
        pitches.append(f0)
        energies[i] = energy

    max_energy = float(energies.max()) if energies.size else 0.0
    voiced_threshold = max_energy * 0.12 if max_energy > 0 else 1.0
    grid = _estimate_grid_seconds(energies)
    hop_time = HOP / SAMPLE_RATE
    frames_per_cell = max(1, round(grid / hop_time))

    key_pc = MELODY_KEYS.get(key, 0)
    intervals = MELODY_SCALES.get(scale, MELODY_SCALES["major"])["intervals"]

    cell_notes: list[int | None] = []
    n_cells = max(1, len(frames) // frames_per_cell)
    for c in range(n_cells):
        start = c * frames_per_cell
        end = min(start + frames_per_cell, len(frames))
        cell_pitches = [p for p in pitches[start:end] if p is not None]
        cell_energy = float(np.mean(energies[start:end])) if end > start else 0.0
        if not cell_pitches or cell_energy < voiced_threshold:
            cell_notes.append(None)
            continue
        median_freq = float(np.median(cell_pitches))
        midi = _nearest_scale_midi(_freq_to_midi(median_freq), key_pc, intervals)
        cell_notes.append(_clamp_register(midi))

    # Regroupe les cellules consécutives de même note en une seule note tenue, avec une limite
    # (4 cellules) pour garder du mouvement rythmique même sur un passage source très stable.
    events: list[dict] = []
    i = 0
    max_run = 4
    while i < len(cell_notes):
        note = cell_notes[i]
        run = 1
        while i + run < len(cell_notes) and cell_notes[i + run] == note and run < max_run:
            run += 1
        if note is not None:
            events.append({"midi": note, "start": i * grid, "duration": run * grid})
        i += run

    return events, grid


def _adsr(n: int, sr: int, attack: float, decay: float, sustain_level: float, release: float, curve: float) -> np.ndarray:
    a = min(int(attack * sr), n)
    r = min(int(release * sr), max(0, n - a))
    d_max = max(0, n - a - r)
    d = min(int(decay * sr), d_max)
    s = max(0, n - a - d - r)

    env = np.ones(n)
    if a > 0:
        env[:a] = np.linspace(0.0, 1.0, a)
    if d > 0:
        t = np.linspace(0.0, 1.0, d)
        env[a:a + d] = 1.0 - (1.0 - sustain_level) * (1.0 - np.exp(-curve * t)) / (1.0 - math.exp(-curve))
    if s > 0:
        env[a + d:a + d + s] = sustain_level
    if r > 0:
        tail_start = env[a + d + s - 1] if (a + d + s) > 0 else sustain_level
        env[a + d + s:a + d + s + r] = np.linspace(tail_start, 0.0, r)
    return env


def _synth_note(midi: int, duration: float, timbre: dict, rng: np.random.Generator) -> np.ndarray:
    n = max(1, int(duration * SAMPLE_RATE))
    t = np.arange(n) / SAMPLE_RATE
    detune_cents = rng.uniform(-3.0, 3.0)
    freq = _midi_to_freq(midi) * (2 ** (detune_cents / 1200))

    buf = np.zeros(n)
    vibrato_hz = timbre.get("vibrato", 0.0)
    vibrato_mod = 1.0
    if vibrato_hz > 0:
        depth = 0.004
        vibrato_mod = 1.0 + depth * np.sin(2 * math.pi * vibrato_hz * t)

    for h, (amp, detune) in enumerate(zip(timbre["harmonics"], timbre["detune"]), start=1):
        partial_freq = freq * h + detune
        buf += amp * np.sin(2 * math.pi * partial_freq * t * vibrato_mod)

    peak = np.max(np.abs(buf))
    if peak > 0:
        buf /= peak

    env = _adsr(n, SAMPLE_RATE, timbre["attack"], timbre["decay"], timbre["sustain"], timbre["release"], timbre["decay_curve"])
    return buf * env * rng.uniform(0.85, 1.0)


def _synth_kick(rng: np.random.Generator) -> np.ndarray:
    duration = 0.18
    n = int(duration * SAMPLE_RATE)
    t = np.arange(n) / SAMPLE_RATE
    freq = 45.0 + 90.0 * np.exp(-22.0 * t)
    phase = 2 * math.pi * np.cumsum(freq) / SAMPLE_RATE
    env = np.exp(-16.0 * t)
    return np.sin(phase) * env * rng.uniform(0.9, 1.0)


def _synth_hihat(rng: np.random.Generator) -> np.ndarray:
    duration = 0.05
    n = int(duration * SAMPLE_RATE)
    noise = rng.uniform(-1.0, 1.0, n)
    bright = np.diff(noise, prepend=0.0)  # accentue les hautes fréquences, façon cymbale
    env = np.exp(-70.0 * np.arange(n) / SAMPLE_RATE)
    return bright * env * rng.uniform(0.8, 1.0)


def _render_events(events: list[dict], timbre: dict, rng: np.random.Generator) -> np.ndarray:
    """Rend une liste d'événements `{"midi": [notes...], "start", "duration"}` en un buffer mixé —
    plusieurs notes simultanées (accord) sont sommées avec un gain réduit pour éviter l'écrêtage."""
    if not events:
        return np.zeros(0)
    total = max(e["start"] + e["duration"] for e in events) + timbre["release"]
    out = np.zeros(int(total * SAMPLE_RATE) + SAMPLE_RATE)
    for ev in events:
        notes = ev["midi"] if isinstance(ev["midi"], (list, tuple)) else [ev["midi"]]
        chord_gain = 1.0 / math.sqrt(len(notes))
        # Toutes les notes d'un même événement partagent la durée, donc `_synth_note` leur donne
        # systématiquement le même nombre d'échantillons : la somme directe est sûre.
        mixed = sum(_synth_note(m, ev["duration"], timbre, rng) * chord_gain for m in notes)
        start_sample = int(ev["start"] * SAMPLE_RATE)
        end_sample = start_sample + len(mixed)
        if end_sample > len(out):
            out = np.pad(out, (0, end_sample - len(out)))
        out[start_sample:end_sample] += mixed
    return out


def _scale_degrees(scale: str) -> list[int]:
    return sorted(MELODY_SCALES.get(scale, MELODY_SCALES["major"])["intervals"])


def _build_chord_options(key_pc: int, degrees: list[int]) -> list[dict]:
    """Construit un accord (triade) empilé par tierces sur chaque degré de la gamme — même sur une
    gamme pentatonique, où les 'tierces' sautent des degrés, ce qui reste diatoniquement correct."""
    n = len(degrees)
    chords = []
    for i in range(n):
        root = degrees[i]
        third = degrees[(i + 2) % n] + 12 * ((i + 2) // n)
        fifth = degrees[(i + 4) % n] + 12 * ((i + 4) // n)
        chords.append({
            "root_pc": (key_pc + root) % 12,
            "third_pc": (key_pc + third) % 12,
            "fifth_pc": (key_pc + fifth) % 12,
        })
        chords[-1]["pcs"] = {chords[-1]["root_pc"], chords[-1]["third_pc"], chords[-1]["fifth_pc"]}
    return chords


def _pc_to_register(pc: int, lo: int, hi: int) -> int:
    return lo + ((pc - lo) % 12)


def _build_bar_chords(events: list[dict], grid: float, key_pc: int, scale: str) -> list[dict]:
    """Découpe la mélodie en mesures et choisit, pour chacune, l'accord diatonique qui couvre le
    mieux (en durée cumulée) les notes jouées à ce moment — une harmonisation automatique simple
    mais musicalement cohérente, comme un backing instrumental construit à l'oreille."""
    if not events:
        return []
    bar_duration = grid * BAR_CELLS
    total_end = max(e["start"] + e["duration"] for e in events)
    n_bars = max(1, math.ceil(total_end / bar_duration))
    chords = _build_chord_options(key_pc, _scale_degrees(scale))

    bar_chords = []
    for b in range(n_bars):
        bar_start = b * bar_duration
        bar_end = bar_start + bar_duration
        scores = [0.0] * len(chords)
        for e in events:
            overlap = min(e["start"] + e["duration"], bar_end) - max(e["start"], bar_start)
            if overlap <= 0:
                continue
            pc = e["midi"] % 12
            for i, ch in enumerate(chords):
                if pc in ch["pcs"]:
                    scores[i] += overlap
        best_i = max(range(len(chords)), key=lambda i: scores[i]) if any(scores) else 0
        bar_chords.append({"start": bar_start, "duration": bar_duration, "chord": chords[best_i]})
    return bar_chords


def _bass_events(bar_chords: list[dict]) -> list[dict]:
    """Un motif basse/quinte par mesure (temps 1 et 3) — le mouvement classique d'une section
    rythmique pop/rock, ancré une octave sous la mélodie."""
    events = []
    for bc in bar_chords:
        half = bc["duration"] / 2
        root_midi = _pc_to_register(bc["chord"]["root_pc"], 36, 47)
        fifth_midi = _pc_to_register(bc["chord"]["fifth_pc"], 36, 47)
        events.append({"midi": [root_midi], "start": bc["start"], "duration": half * 0.92})
        events.append({"midi": [fifth_midi], "start": bc["start"] + half, "duration": half * 0.92})
    return events


def _pad_events(bar_chords: list[dict]) -> list[dict]:
    """Une nappe d'accord tenue par mesure — l'habillage harmonique qui donne le sentiment
    d'un vrai instrumental plutôt que d'une ligne mélodique seule."""
    events = []
    for bc in bar_chords:
        ch = bc["chord"]
        midis = [
            _pc_to_register(ch["root_pc"], 55, 66),
            _pc_to_register(ch["third_pc"], 55, 66),
            _pc_to_register(ch["fifth_pc"], 55, 66),
        ]
        events.append({"midi": midis, "start": bc["start"], "duration": bc["duration"] * 0.97})
    return events


def _render_percussion(total_duration: float, grid: float, rng: np.random.Generator) -> np.ndarray:
    """Charleston sur chaque temps de la grille, grosse caisse sur les temps 1 et 3 de chaque
    mesure — un habillage rythmique minimal qui suffit à faire sentir un tempo réel."""
    n_cells = max(1, int(math.ceil(total_duration / grid)))
    out = np.zeros(int(total_duration * SAMPLE_RATE) + SAMPLE_RATE)

    def _mix(sample_audio: np.ndarray, t: float, gain: float) -> None:
        nonlocal out
        start = int(t * SAMPLE_RATE)
        end = start + len(sample_audio)
        if end > len(out):
            out = np.pad(out, (0, end - len(out)))
        out[start:end] += sample_audio * gain

    for c in range(n_cells):
        t = c * grid
        _mix(_synth_hihat(rng), t, 0.12)
        if c % (BAR_CELLS // 2) == 0:
            _mix(_synth_kick(rng), t, 0.5)
    return out


def _mix_buffers(buffers: list[np.ndarray]) -> np.ndarray:
    length = max((len(b) for b in buffers if b.size), default=0)
    out = np.zeros(length)
    for b in buffers:
        out[: len(b)] += b
    return out


def generate_melody(
    source_path: Path, key: str, scale: str, timbre_name: str, output_path: Path,
    workdir: Path, layers: set[str] | None = None, on_progress: ProgressCallback | None = None,
) -> None:
    """Analyse `source_path` (audio ou vidéo) pour en extraire une hauteur et un tempo dominants,
    puis rejoue le résultat comme une mélodie synthétique quantifiée sur `scale`/`key`, avec le
    timbre `timbre_name`. Le fichier source n'est jamais réutilisé tel quel : seule sa courbe
    mélodique sert de matière première.

    `layers` (sous-ensemble de `MELODY_LAYERS` — "bass", "pad", "drums") ajoute un accompagnement
    harmonisé automatiquement (un accord diatonique par mesure, choisi pour coller au mieux aux
    notes jouées) : n'importe quelle combinaison, ou aucune pour une mélodie seule."""
    if key not in MELODY_KEYS:
        raise MelodyError(f"Tonalité inconnue : {key}")
    if scale not in MELODY_SCALES:
        raise MelodyError(f"Gamme inconnue : {scale}")
    if timbre_name not in MELODY_TIMBRES:
        raise MelodyError(f"Timbre inconnu : {timbre_name}")
    layers = {l for l in (layers or set()) if l in MELODY_LAYERS}

    if on_progress:
        on_progress(0.05)
    samples = _extract_mono_pcm(source_path, workdir)
    if on_progress:
        on_progress(0.25)

    events, grid = _build_note_events(samples, key, scale)
    if not events:
        raise MelodyError("Aucune hauteur exploitable détectée dans cette source — essayez un extrait plus musical.")
    if on_progress:
        on_progress(0.4)

    key_pc = MELODY_KEYS[key]
    timbre = MELODY_TIMBRES[timbre_name]
    rng = np.random.default_rng(0)

    lead_events = [{"midi": [e["midi"]], "start": e["start"], "duration": e["duration"]} for e in events]
    lead_buf = _render_events(lead_events, timbre, rng)
    if on_progress:
        on_progress(0.6 if layers else 0.8)

    buffers = [lead_buf]
    if layers:
        total_duration = events[-1]["start"] + events[-1]["duration"]
        bar_chords = _build_bar_chords(events, grid, key_pc, scale) if ("bass" in layers or "pad" in layers) else []
        if "bass" in layers:
            buffers.append(_render_events(_bass_events(bar_chords), BASS_TIMBRE, rng) * 0.6)
        if "pad" in layers:
            buffers.append(_render_events(_pad_events(bar_chords), MELODY_TIMBRES["pad"], rng) * 0.3)
        if "drums" in layers:
            buffers.append(_render_percussion(total_duration, grid, rng))
        if on_progress:
            on_progress(0.8)

    out = _mix_buffers(buffers)
    peak = np.max(np.abs(out))
    if peak > 0:
        out = out / peak * 0.9

    wav_path = workdir / "melody_render.wav"
    pcm16 = (out * 32767.0).astype(np.int16)
    with wave.open(str(wav_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm16.tobytes())
    if on_progress:
        on_progress(0.85)

    cmd = ["ffmpeg", "-y", "-i", str(wav_path), "-c:a", "aac", str(output_path)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    wav_path.unlink(missing_ok=True)
    if result.returncode != 0:
        raise MelodyError("Échec de l'encodage final de la mélodie.")
    if on_progress:
        on_progress(1.0)
