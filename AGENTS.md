# AGENTS.md — Melody Plotter (high-level summary)

Browser-based pitch visualizer. Captures mic audio, runs FFT to detect dominant frequency, transposes to a relative C scale, and plots on a scrolling 48-key piano roll.

## Files (5 total, ~1000 lines, zero dependencies)

| File | Role |
|------|------|
| `index.html` | Single-page app shell: buttons, status, labels row, piano roll wrapper (scrollable), scrollback slider, canvas overlay. Scripts loaded in order: audio → piano → app. |
| `style.css` | Dark theme, flex column layout (`#app` fills `100dvh`), mobile-first (max-width 800px, 48px touch targets), 48-column piano key grid, button/state styling. |
| `js/audio-processor.js` | Mic capture + FFT pitch detection. IIFE, exposes `AudioProcessor.create(callbacks)`. Uses 4096-point FFT, 40ms interval, -50dB silence threshold, parabolic interpolation. State machine: start/pause/stop with stream lifecycle management. |
| `js/piano-renderer.js` | Piano roll DOM + canvas rendering. IIFE, exposes `PianoRenderer.create(options)`. Builds 48-column HTML key grid, overlay canvas draws red pitch polyline. 4px per data row, newest at top, visible-viewport-only rendering on scroll. Root C = column 12. |
| `js/app.js` | Controller/state machine. IIFE, auto-runs. Wires audio callbacks → renderer. Manages IDLE → RECORDING → PAUSED → STOPPED transitions, button states, scrollback controls. |

## Module pattern

All JS uses IIFEs attaching to `window.*` (e.g., `window.AudioProcessor`). Classic `<script>` tags — no ES modules, no bundler. Works on `file://`.

## Key constants (tunables)

- **FFT**: 4096 points, no smoothing (`smoothingTimeConstant = 0`)
- **Sample interval**: 40 ms (~25 fps) via `setTimeout`
- **Silence threshold**: -50 dB
- **Piano roll**: 4 octaves (1 below root, 2 above) = 48 columns, 4 px/row

## Data flow

```
Mic → AudioContext → AnalyserNode(4096 FFT) → setTimeout(40ms) → getByteFrequencyData()
  → find max bin → parabolic interpolation → Hz → onPitch callback
  → PianoRenderer.addDataPoint() → compute semitone column → push to dataPoints[]
  → resizeCanvas() → render() visible viewport → auto-scroll to top
```

Root calibration: first detected tone sets `rootFrequency`, labeled C. All other notes computed via equal temperament: `f = root * 2^(semitoneOffset/12)`.

## Common change targets

- **Threshold/FFT/sample rate**: `js/audio-processor.js` (named constants at top)
- **Visuals (color, line width, key styles)**: `js/piano-renderer.js` constants + `style.css`
- **Octave range**: `js/piano-renderer.js` (`OCTAVES_BELOW`, `OCTAVES_ABOVE`) — also update `NUM_COLUMNS` and root offset
- **Layout/buttons**: `style.css`
- **State machine/UX**: `js/app.js`

Full details in README.md (what it does, design rationale) and FILES.md (detailed codebase guide).
