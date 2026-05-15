# AGENTS.md — Melody Plotter

Browser-based pitch visualizer. Captures mic audio, runs FFT to detect dominant frequency, snaps the first detected tone to the closest equal-tempered note (A4=440Hz) and centers the piano roll around it. Plots on a scrolling 36-key piano roll with actual note names and octave numbers.

## Files (5 total, ~1000 lines, zero dependencies)

| File | Role |
|------|------|
| `index.html` | Single-page app shell: RECORD/PAUSE/RESET buttons, status, labels row, piano roll wrapper (scrollable), scrollback slider, canvas overlay. Scripts loaded in order: audio → piano → app. |
| `style.css` | Dark theme, flex column layout (`#app` fills `100dvh`), mobile-first (max-width 800px, 48px touch targets), 36-column piano key grid, button/state styling. |
| `js/audio-processor.js` | Mic capture + FFT pitch detection. IIFE, exposes `AudioProcessor.create(callbacks)`. Uses 4096-point FFT, 40ms interval, -25dB silence threshold, parabolic interpolation. State machine: start/pause/stop with stream lifecycle management. |
| `js/piano-renderer.js` | Piano roll DOM + canvas rendering. IIFE, exposes `PianoRenderer.create(options)`. Builds 36-column HTML key grid, overlay canvas draws red pitch polyline. 4px per data row, newest at top, visible-viewport-only rendering on scroll. First detected note = column 13. |
| `js/app.js` | Controller/state machine. IIFE, auto-runs. Wires audio callbacks → renderer. 3-state: IDLE → RECORDING ↔ PAUSED. RESET button (cyan) transitions PAUSED → IDLE, clears history and releases mic. |

## Module pattern

All JS uses IIFEs attaching to `window.*` (e.g., `window.AudioProcessor`). Classic `<script>` tags — no ES modules, no bundler. Works on `file://`.

## Key constants (tunables)

- **FFT**: 4096 points, no smoothing (`smoothingTimeConstant = 0`)
- **Sample interval**: 40 ms (~25 fps) via `setTimeout`
- **Silence threshold**: -25 dB
- **Piano roll**: 3 octaves (1 below center, 1 above) = 36 columns, 4 px/row

## Data flow

```
Mic → AudioContext → AnalyserNode(4096 FFT) → setTimeout(40ms) → getByteFrequencyData()
  → find max bin → parabolic interpolation → Hz → onPitch callback
  → PianoRenderer.addDataPoint() → compute semitone column → push to dataPoints[]
  → resizeCanvas() → render() visible viewport → auto-scroll to top
```

Range calibration: first detected tone is snapped to closest equal-tempered note (A4 = 440 Hz) and mapped to column 13. The piano roll spans 1 octave below and 1 octave above that note, with actual note names + octave numbers on the labels (e.g. A4, C#5). Piano keys follow actual black/white note pattern.

## Common change targets

- **Threshold/FFT/sample rate**: `js/audio-processor.js` (named constants at top)
- **Visuals (color, line width, key styles)**: `js/piano-renderer.js` constants + `style.css`
- **Octave range**: `js/piano-renderer.js` (`OCTAVES_BELOW`, `OCTAVES_ABOVE`) — also update `NUM_COLUMNS` and center offset
- **Layout/buttons**: `style.css`
- **State machine/UX**: `js/app.js`

