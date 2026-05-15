# AGENTS.md — Melody Plotter Codebase Guide

## Overview

Melody Plotter captures microphone audio, detects the dominant pitch via FFT, calibrates on the first tone as a "root note" (always labeled C), and plots subsequent pitches on a scrolling piano roll. The piano roll spans 4 octaves (one below root, two above), scrolls top-to-bottom (newest data at top), and supports pause/stop with scrollback through recorded history.

Five files, ~1000 lines total. No third-party libraries. Pure HTML, CSS, and vanilla JS (ES5-style IIFE modules loaded via `<script>` tags — no ES modules or bundler needed).

---

## File-by-file breakdown

### `index.html` — page structure

A single-page app with a vertical flex column (`#app`) that fills the viewport (`100dvh`). Element hierarchy from top to bottom:

1. **`<h1>`** — title
2. **`#controls`** — three buttons: RECORD, PAUSE, STOP. Initial state: only RECORD enabled.
3. **`#status`** — single-line text showing current state ("Listening for root note…", "Root: 523 Hz — Recording…", "Paused", etc.)
4. **`#labels-row`** — 48 flex cells, one per piano column. Each cell contains two `<span>` elements: `.label-note` (note name like C, C#, D…) and `.label-freq` (frequency in Hz, or em-dash placeholder before calibration). Populated dynamically by `PianoRenderer.buildPianoKeys()`.
5. **`#piano-roll-wrapper`** — the scrollable viewport (`overflow-y: scroll`, `flex: 1` to fill remaining space). Contains:
   - **`#piano-roll-inner`** — `position: relative` wrapper whose height is set by JS to `totalRows * PIXELS_PER_ROW`.
     - **`#piano-keys`** — absolutely positioned, `display: flex`, 48 `.piano-key` divs (white or black background). Height matches the inner wrapper via inline style.
     - **`#pitch-canvas`** — absolutely positioned canvas with `pointer-events: none`, transparent background, renders only the red pitch line over the keys.
6. **`#scrollback-control`** — hidden by default (`display: none`), shown during PAUSED/STOPPED states. Contains a range slider and a "Latest" button.

Scripts are loaded in dependency order: `audio-processor.js` → `piano-renderer.js` → `app.js`. Each script attaches to the global scope (e.g., `window.AudioProcessor`).

### `style.css` — layout and theming

- **Dark theme**: `#1a1a2e` background, `#e0e0e0` text, red (`#ff4757`) accent for recording elements.
- **Mobile-first**: the `#app` container uses `max-width: 800px` with `margin: 0 auto`, so it centers on desktop but fills the screen on mobile. Buttons have `min-height: 48px` for touch targets.
- **Flex column layout**: `#app` is `display: flex; flex-direction: column; height: 100dvh`. All children except the piano roll wrapper have `flex-shrink: 0` so they remain fixed. The wrapper has `flex: 1` to absorb remaining space.
- **Piano keys**: 48 equal-width columns (`flex: 1` on each `.piano-key`). White keys get `rgba(255,255,255,0.08)`, black keys get `rgba(0,0,0,0.3)`. Octave boundaries (every 12th key, where `semitone === 0`) get a subtle left border.
- **Labels row**: mirrors the 48-column flex layout so labels align with keys. The root C column (octave 0, note C) gets `.root` class with red text.
- **Button states**: `:disabled` reduces opacity to 0.35. `:active` has a slight scale-down for tactile feedback.
- **Scrollback controls**: toggled via `.visible` class (sets `display: flex` from `display: none`).

All key dimensions (button sizes, label heights, colors) are in this file. If you need to adjust how the piano roll looks, focus here.

### `js/audio-processor.js` — microphone capture and pitch detection

**Module pattern**: IIFE that returns `{ create }`. `AudioProcessor.create(callbacks)` returns an instance with `start()`, `pause()`, `stop()`, and `getRootFrequency()`.

**Tunable constants** (at top of file):
- `MIN_DB_THRESHOLD = -50` — signals below this are treated as silence
- `FFT_SIZE = 4096` — AnalyserNode window size
- `SAMPLE_INTERVAL_MS = 40` — ~25 fps processing rate

**Internal state**:
- `audioContext` — `AudioContext` instance (created fresh each `start()`)
- `analyser` — `AnalyserNode`, FFT size 4096, smoothing 0
- `stream` — `MediaStream` from `getUserMedia`
- `source` — `MediaStreamSourceNode` connecting stream → analyser
- `rootFrequency` — set once on first valid tone, null until calibrated
- `isRunning`, `isPaused` — lifecycle flags
- `timerId` — `setTimeout` handle for the processing loop
- `buffer` — `Uint8Array` sized to `frequencyBinCount` (FFT_SIZE / 2 = 2048)

**Key functions**:

- **`start()`** — Two paths:
  1. **Resume** (when `isPaused` is true): clears `isPaused`, calls `scheduleNext()`, does not touch the stream or root. Synchronous.
  2. **Fresh start**: calls `getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })`, creates `AudioContext` (with iOS Safari `resume()` fallback), creates `AnalyserNode`, connects stream → analyser (NOT to destination — avoids feedback), initializes buffer, sets `rootFrequency = null`, starts processing loop. Async.

- **`pause()`** — Sets `isPaused = true`, clears the timeout. Stream and AudioContext stay alive.

- **`stop()`** — Full teardown: clears timeout, disconnects source, stops all media tracks, closes AudioContext, nulls all references including `rootFrequency`.

- **`scheduleNext()`** — Recursive `setTimeout` chain (not `requestAnimationFrame`). Called every `SAMPLE_INTERVAL_MS` ms while `isRunning && !isPaused`.

- **`processFrame()`** — The core loop:
  1. Calls `analyser.getByteFrequencyData(buffer)` — fills buffer with 0–255 magnitudes
  2. Finds bin with maximum value (linear scan, O(n))
  3. Converts to dB via `magnitudeToDb(maxMag)` (approximation: `20 * log10(value/255)`)
  4. If below `MIN_DB_THRESHOLD`, invokes `onPitch(null, dbLevel)` and returns
  5. Refines peak bin via `interpolatePeak()` (parabolic interpolation over 3 adjacent bins) — improves frequency resolution beyond bin spacing
  6. Converts fractional bin to Hz via `binToFrequency()`
  7. If `rootFrequency === null`, sets it and fires `onRootDetected(rootFrequency)`
  8. Fires `onPitch(frequency, dbLevel)` regardless

**Helper functions** (module-private, not exported):
- `binToFrequency(binIndex, sampleRate, fftSize)` — simple linear mapping
- `magnitudeToDb(magnitude)` — `20 * log10(m/255)`, returns `-Infinity` for 0
- `interpolatePeak(binIndex, mags)` — `bin + (right - left) / (2 * (2*mid - left - right))`

**Callback interface** (passed via `create()`):
- `onPitch(frequency, dbLevel)` — called every cycle. `frequency` is null when below threshold.
- `onRootDetected(rootFrequency)` — called exactly once, when first valid tone is found.
- `onStatus(message)` — human-readable status updates.

### `js/piano-renderer.js` — piano roll HTML, canvas overlay, and rendering

**Module pattern**: Same IIFE style as audio-processor. `PianoRenderer.create(options)` takes DOM element references.

**Tunable constants**:
- `PIXELS_PER_ROW = 4` — vertical px per data point on canvas
- `HISTORY_SECONDS = 5` — not directly enforced; the viewport is roughly `viewHeight / PIXELS_PER_ROW` rows tall, which typically maps to ~5 seconds of data at 25 fps
- `PLOT_COLOR = '#ff4757'`, `PLOT_LINE_WIDTH = 5`, `PLOT_DOT_RADIUS = 3` — visual constants
- `OCTAVES_BELOW = 1`, `OCTAVES_ABOVE = 2` — range around root (48 columns total)
- `NOTE_NAMES`, `IS_BLACK` — lookup arrays for the 12 semitones

**Internal state**:
- `columns[]` — array of 48 objects, each with `{ index, x, width, noteName, isBlack, isOctaveStart, octave, frequency }`. `x` and `width` are pixel positions derived from `keysEl.clientWidth / 48`. `frequency` is null until `setRootFrequency()` is called.
- `dataPoints[]` — growing array of `{ frequency, columnIndex, dbLevel }`. Index 0 = oldest, last = newest. `columnIndex` is -1 for silent frames.
- `totalRows` — `dataPoints.length` (kept separately for convenience)
- `rootFrequency` — cached from `setRootFrequency()`
- `autoScroll` — boolean flag controlling whether `addDataPoint()` sets `scrollTop = 0`
- `ctx` — 2D canvas context, acquired once at creation

**Key functions**:

- **`buildPianoKeys()`** — Guards if `keysEl.clientWidth <= 0`. Computes 48 column objects with pixel positions (`x = i * columnWidth`). Regenerates the HTML for `#piano-keys` (flex divs with `.white`/`.black`/`.octave-start` classes) and `#labels-row` (`.label-cell` divs with note name and em-dash placeholder). Also called on window resize.

- **`setRootFrequency(freq)`** — Stores the root, computes `col.frequency = root * 2^(semitoneOffset/12)` for all 48 columns, updates the `.label-freq` spans in the labels row.

- **`addDataPoint(frequency, dbLevel)`** — The main entry point called by the audio processor's `onPitch` callback (via `app.js`).
  1. Lazy-initializes piano keys if `columns` is empty (handles slow mobile layout).
  2. If `frequency` is not null and `rootFrequency` is set, computes `semitoneOffset = 12 * log2(freq / root)`, rounds to nearest semitone, maps to column index 0–47 (root is column 12).
  3. Pushes `{ frequency, columnIndex, dbLevel }` to `dataPoints`.
  4. Increments `totalRows`, calls `resizeCanvas()`, calls `render()`.
  5. If `autoScroll` is true, sets `wrapperEl.scrollTop = 0` to keep newest data visible.

- **`resizeCanvas()`** — Sets `#piano-keys` height and canvas dimensions to `totalRows * PIXELS_PER_ROW`. Uses `devicePixelRatio` for sharp rendering on high-DPI screens. Resets the canvas transform matrix.

- **`render()`** — Redraws only the visible portion of the canvas:
  1. Reads `wrapperEl.scrollTop` and `wrapperEl.clientHeight` to determine which rows are visible.
  2. Clears the entire canvas with `clearRect` (clearing only the visible rect would leave stale content when scrolling back).
  3. Iterates visible rows. Builds continuous polyline segments — each segment is a series of `moveTo`/`lineTo` calls within one `beginPath()`/`stroke()`. Gaps (`columnIndex < 0`) end the current segment and start a new one.
  4. Y-coordinate formula: `y = (totalRows - 1 - i) * PIXELS_PER_ROW + PIXELS_PER_ROW / 2`. This places row 0 (oldest) at the bottom and the last row (newest) at the top.

- **`clear()`** — Resets `dataPoints`, `totalRows`, `rootFrequency`, clears column frequencies, sets `#piano-keys` height to 0, clears canvas, resets all label cells to em-dashes. Does NOT clear the `columns` array (width metadata is preserved for reuse).

- **`setAutoScroll(enable)`** — Toggles the flag and adds/removes an `auto-scroll` class on the wrapper (currently unused by CSS, left for potential future styling).

- **`showScrollbackControls(show)`** — Toggles `.visible` class on the scrollback container.

- **`updateSlider()`** — Sets the range slider's `max` to `max(0, totalHeight - viewHeight)` and `value` to current `scrollTop`.

- **`scrollToSlider()`** — Sets `scrollTop` from the slider value. Rendering is triggered by the scroll event listener.

- **`scrollToLatest()`** — Sets `scrollTop = 0`. Rendering triggered by scroll event.

**Event listeners** (set up in `create()`):
- **Scroll on wrapper**: Always calls `render()` when data exists (to repaint on manual scroll). Also updates the slider position when `!autoScroll && scrollback visible`.
- **Window resize**: Rebuilds keys (recalculates column widths), re-applies root frequency (to update labels with potentially new layout), resizes canvas, re-renders.

**Edge cases handled**:
- Container width is 0 (keys not built, returns early; lazy retry in `addDataPoint`)
- `devicePixelRatio` for canvas scaling
- Empty data (render returns early, slider clamped to 0)
- Gaps in signal (columnIndex -1 breaks the polyline path)

### `js/app.js` — controller and state machine

**Module pattern**: IIFE, no exports. Runs immediately.

**DOM references**: All 11 elements from `index.html` are captured at the top.

**State machine**: Four states defined as string constants:
```
IDLE ──RECORD──▶ RECORDING ──PAUSE──▶ PAUSED ──RECORD──▶ RECORDING
  ▲                │        ▲            │                    │
  │                ▼        │            ▼                    │
  └───────ERROR────┘        └──STOP────STOPPED◀──STOP─────────┘
                                    ▲
                                    └──STOP (from PAUSED)─────┘
```

Transitions are managed by `enterState(newState)`, which sets button enabled/disabled states, auto-scroll, scrollback control visibility, and status CSS class.

**Button handlers**:

- **RECORD click** (async):
  - If PAUSED: calls `enterState(RECORDING)` immediately, then `processor.start()` (resume path — synchronous, keeps root and data).
  - Otherwise (IDLE or STOPPED): calls `renderer.clear()`, then `await processor.start()` (fresh start — async, gets mic). `enterState(RECORDING)` is called only after the promise resolves. On error (e.g., permission denied), falls back to IDLE.

- **PAUSE click**: `processor.pause()`, `enterState(PAUSED)`.

- **STOP click**: `processor.stop()`, manually resets label frequency spans to em-dashes (since the renderer's `stop()` doesn't clear labels — that's `clear()`'s job), then `enterState(STOPPED)`.

**Scrollback slider**: On `input` event, calls `renderer.scrollToSlider()`, which sets `scrollTop` and lets the scroll event trigger a render.

**"Latest" button**: Calls `renderer.scrollToLatest()`.

**Initialization**: `init()` uses a double `requestAnimationFrame` to ensure the DOM layout is computed before calling `renderer.buildPianoKeys()` (which depends on `clientWidth`). Called on `DOMContentLoaded` (or immediately if the document is already loaded).

**Callback wiring**: `AudioProcessor` callbacks are wired directly to `PianoRenderer` and status element methods — no intermediate logic.

---

## Data flow during recording

```
Microphone → AudioContext → AnalyserNode (4096 FFT, no smoothing)
                                  │
                          setTimeout loop (40ms)
                                  │
                          getByteFrequencyData()
                                  │
                          find max bin → interpolate → Hz
                                  │
                          is > -50 dB? ──No──▶ onPitch(null, …) → columnIndex = -1
                                  │
                                 Yes
                                  │
                          rootFrequency null? ──Yes──▶ set root, onRootDetected()
                                  │                        │
                                  No              setRootFrequency() → labels update
                                  │
                          onPitch(freq, dB)
                                  │
                          addDataPoint() → compute column → push to dataPoints[]
                                  │
                          resizeCanvas() → grow keys + canvas height
                                  │
                          render() → clear canvas, draw visible polyline
                                  │
                          wrapperEl.scrollTop = 0 (if autoScroll)
```

---

## Where to make common changes

| Change | File(s) | What to modify |
|--------|---------|----------------|
| Adjust dB threshold | `audio-processor.js` | `MIN_DB_THRESHOLD` constant |
| Change FFT size | `audio-processor.js` | `FFT_SIZE` constant (must be power of 2) |
| Change sampling rate | `audio-processor.js` | `SAMPLE_INTERVAL_MS` constant |
| Change visible history | `piano-renderer.js` | `PIXELS_PER_ROW` and/or `HISTORY_SECONDS` (note: `HISTORY_SECONDS` is not enforced in code — to enforce, cap `totalRows` or trim `dataPoints`) |
| Change octave range | `piano-renderer.js` | `OCTAVES_BELOW`, `OCTAVES_ABOVE` constants (also need to update `NUM_COLUMNS` and the root column offset in `addDataPoint` and `setRootFrequency`) |
| Change plot color/thickness | `piano-renderer.js` | `PLOT_COLOR`, `PLOT_LINE_WIDTH` |
| Change button styling | `style.css` | `.btn`, `.btn-record`, `.btn-pause`, `.btn-stop` |
| Change piano key colors | `style.css` | `.piano-key.white`, `.piano-key.black` |
| Add visual effects to canvas | `piano-renderer.js` | `render()` function |
| Add polyphony (multiple pitches) | `audio-processor.js` + `piano-renderer.js` | Change peak detection to find multiple peaks, change data model from single `columnIndex` to array |
| Add recording export | New file + `app.js` | Read `dataPoints` array (accessible via new renderer method) |
| Change scroll direction (newest at bottom) | `piano-renderer.js` | Flip the Y-coordinate formula in `render()` and swap `scrollTop = 0` to `scrollTop = max` in `addDataPoint()` |
| Support desktop-only layout | `style.css` | Adjust `max-width`, font sizes, button sizing |

---

## Design decisions and rationale

- **No ES modules**: Loading from `file://` (local testing without a server) blocks ES module imports due to CORS. Classic `<script>` tags work everywhere.
- **IIFE module pattern**: Each JS file creates a namespace on `window` (e.g., `window.AudioProcessor`) but keeps internal state private via closure. This avoids global variable pollution while staying compatible with script-tag loading.
- **`setTimeout` loop instead of `requestAnimationFrame`**: rAF fires at display refresh rate (~60 fps), which is too fast for meaningful pitch detection and wastes CPU. A 40 ms interval (~25 fps) is sufficient for human-perceptible melody plotting.
- **AnalyserNode smoothing disabled**: `smoothingTimeConstant = 0` ensures each FFT frame is independent, giving accurate peak detection without temporal smearing.
- **Parabolic interpolation on FFT peak**: Without interpolation, frequency resolution is limited to `sampleRate / fftSize` (~10.8 Hz at 44100/4096). Interpolation over three adjacent bins recovers sub-bin precision, critical for distinguishing adjacent semitones at low frequencies.
- **Canvas overlays HTML keys (not drawn on canvas)**: The piano key grid is static HTML/CSS — it doesn't need re-rendering. Only the moving pitch line is drawn on canvas. The canvas has `pointer-events: none` so all clicks/scrolling pass through to the wrapper.
- **Full canvas clear per render**: Each `render()` call clears the entire canvas and redraws only the visible viewport. This is simpler than tracking dirty regions and is fast enough at 25 fps with ~125 visible data points.
- **Scroll event triggers render**: Rather than calling `render()` explicitly after every scroll position change, the scroll event listener fires it. This handles both programmatic scrolls (via `scrollTop = …`) and user scrolls uniformly.
- **Root note transposition**: The root frequency is always labeled C, and all other keys are labeled relative to it (C#, D, etc.). The column-to-frequency mapping uses equal temperament: `f = root * 2^(semitoneOffset/12)`. This means the display always shows the melody in a C scale, preserving relative intervals regardless of absolute pitch.
