# AGENTS.md — Melody Plotter (high-level summary)

Browser-based pitch visualizer. Captures mic audio, runs FFT to detect dominant frequency, snaps root to closest equal-tempered note (A4=440Hz), and plots on a scrolling 36-key piano roll with actual note names and octave numbers.

## Files (5 total, ~1000 lines, zero dependencies)

| File | Role |
|------|------|
| `index.html` | Single-page app shell: buttons, status, labels row, piano roll wrapper (scrollable), scrollback slider, canvas overlay. Scripts loaded in order: audio → piano → app. |
| `style.css` | Dark theme, flex column layout (`#app` fills `100dvh`), mobile-first (max-width 800px, 48px touch targets), 36-column piano key grid, button/state styling. |
| `js/audio-processor.js` | Mic capture + FFT pitch detection. IIFE, exposes `AudioProcessor.create(callbacks)`. Uses 4096-point FFT, 40ms interval, -50dB silence threshold, parabolic interpolation. State machine: start/pause/stop with stream lifecycle management. |
| `js/piano-renderer.js` | Piano roll DOM + canvas rendering. IIFE, exposes `PianoRenderer.create(options)`. Builds 36-column HTML key grid, overlay canvas draws red pitch polyline. 4px per data row, newest at top, visible-viewport-only rendering on scroll. Root C = column 12. |
| `js/app.js` | Controller/state machine. IIFE, auto-runs. Wires audio callbacks → renderer. Manages IDLE → RECORDING → PAUSED → STOPPED transitions, button states, scrollback controls. |

## Module pattern

All JS uses IIFEs attaching to `window.*` (e.g., `window.AudioProcessor`). Classic `<script>` tags — no ES modules, no bundler. Works on `file://`.

## Key constants (tunables)

- **FFT**: 4096 points, no smoothing (`smoothingTimeConstant = 0`)
- **Sample interval**: 40 ms (~25 fps) via `setTimeout`
- **Silence threshold**: -25 dB
- **Piano roll**: 3 octaves (1 below root, 1 above) = 36 columns, 4 px/row

## Data flow

```
Mic → AudioContext → AnalyserNode(4096 FFT) → setTimeout(40ms) → getByteFrequencyData()
  → find max bin → parabolic interpolation → Hz → onPitch callback
  → PianoRenderer.addDataPoint() → compute semitone column → push to dataPoints[]
  → resizeCanvas() → render() visible viewport → auto-scroll to top
```

Root calibration: first detected tone is snapped to closest equal-tempered note (A4 = 440 Hz). Root column always mapped to column 12 (13th column). Labels show actual note names + octave numbers (e.g. A4, C#5). Piano keys follow actual black/white note pattern.

## Common change targets

- **Threshold/FFT/sample rate**: `js/audio-processor.js` (named constants at top)
- **Visuals (color, line width, key styles)**: `js/piano-renderer.js` constants + `style.css`
- **Octave range**: `js/piano-renderer.js` (`OCTAVES_BELOW`, `OCTAVES_ABOVE`) — also update `NUM_COLUMNS` and root offset
- **Layout/buttons**: `style.css`
- **State machine/UX**: `js/app.js`

