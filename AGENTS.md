# AGENTS.md — Melody Plotter

Browser-based pitch visualizer. Captures mic audio, runs FFT to detect dominant frequency, plots it on a fixed C5–C7 piano roll (25 semitones). Piano keys and labels are static HTML; the canvas overlay renders the pitch polyline.

## Files (5 total, ~1000 lines, zero dependencies)

| File | Role |
|------|------|
| `index.html` | Single-page app shell: RECORD/PAUSE/RESET buttons, status, static labels row (C5–C7 with frequencies), static piano keys (25 columns, black/white pattern), piano roll wrapper (scrollable), scrollback slider, canvas overlay. Scripts loaded in order: audio → piano → app. |
| `style.css` | Dark theme, flex column layout (`#app` fills `100dvh`), mobile-first (max-width 800px, 48px touch targets), 25-column piano key grid, button/state styling. |
| `js/audio-processor.js` | Mic capture + FFT pitch detection. IIFE, exposes `AudioProcessor.create(callbacks)`. Uses 4096-point FFT, 40ms interval, -25dB silence threshold, parabolic interpolation. State machine: start/pause/stop with stream lifecycle management. |
| `js/piano-renderer.js` | Canvas overlay only (static HTML piano keys). IIFE, exposes `PianoRenderer.create(options)`. Computes column x positions on init, maps frequencies to C5–C7 via MIDI (C5 = MIDI 72). Overlay canvas draws red pitch polyline. 4px per data row, newest at top, visible-viewport-only rendering on scroll. |
| `js/app.js` | Controller/state machine. IIFE, auto-runs. Wires audio callbacks → renderer. 3-state: IDLE → RECORDING ↔ PAUSED. RESET button (cyan) transitions PAUSED → IDLE, clears history and releases mic. |

## Module pattern

All JS uses IIFEs attaching to `window.*` (e.g., `window.AudioProcessor`). Classic `<script>` tags — no ES modules, no bundler. Works on `file://`.

## Key constants (tunables)

- **FFT**: 4096 points, no smoothing (`smoothingTimeConstant = 0`)
- **Sample interval**: 40 ms (~25 fps) via `setTimeout`
- **Silence threshold**: -25 dB
- **Piano roll**: 2 octaves + C7 (C5–C7) = 25 columns, 4 px/row, fixed range (no calibration)

## Data flow

```
Mic → AudioContext → AnalyserNode(4096 FFT) → setTimeout(40ms) → getByteFrequencyData()
  → find max bin → parabolic interpolation → Hz → onPitch callback
  → PianoRenderer.addDataPoint() → frequencyToX(MIDI) → push to dataPoints[]
  → resizeCanvas() → render() visible viewport → auto-scroll to top
```

Fixed frequency range: C5 (523 Hz, MIDI 72) to C7 (2093 Hz, MIDI 96).
Frequencies map continuously to pixel positions via `midiNote = 69 + 12 * log2(freq / 440)`.

