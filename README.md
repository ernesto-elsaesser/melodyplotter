# Melody Plotter

A browser-based tool that visualizes the pitch of a whistled or sung melody on a piano roll, transposed to a relative C scale.

## What it does

1. Captures microphone audio via the Web Audio API.
2. Runs FFT analysis to find the dominant frequency in each time slice.
3. Calibrates on the first detected tone, treating it as the root note (displayed as C).
4. Plots subsequent pitches on a 4-octave piano roll (one octave below root, two above), scrolling from top (newest) to bottom (oldest).
5. When paused or stopped, lets you scroll back through recorded history.

## Design Decisions

### Pitch detection

FFT with 4096-point window and no smoothing, sampled every 40 ms (~25 fps). Parabolic interpolation refines the peak bin for better frequency resolution. Signals below -50 dB are treated as silence and not plotted. These parameters target whistling in the 500-2000 Hz range, where 4096-point FFT at common sample rates gives roughly 5-10 Hz bin spacing (under half a semitone at 500 Hz).

### Piano roll layout

48 equal-width chromatic columns, colored to distinguish natural notes from sharps/flats — the same visual convention as a DAW piano roll. Note labels (C through B) are always relative: the detected root frequency is labeled C regardless of its absolute pitch. Column header labels show the computed frequency for each key after calibration.

### Scrolling model

The piano key background is built from HTML divs. A transparent canvas overlays it and draws only the red pitch line. Both layers grow vertically as data accumulates (4 px per sample). A scrollable container holds both; during recording it auto-scrolls to keep the newest data visible at the top. When paused or stopped, native scroll and a range slider let you navigate history.

### Tunable parameters

All key parameters are defined as named constants at the top of the relevant modules:

- Minimum dB threshold (-50 dB)
- FFT size (4096)
- Sampling interval (40 ms)
- Visible history window (5 seconds, approximated by viewport height)
- Pixels per data row (4 px)
- Octave range (1 below root + 2 above)

### State machine

- **Idle** — RECORD button active, no audio stream.
- **Recording** — microphone active, pitch plotted, auto-scroll on.
- **Paused** — stream kept alive, processing halted, scrollback enabled.
- **Stopped** — stream released, root note cleared, display preserved for review. Pressing RECORD starts a fresh session.

### Browser support

Uses only standard Web APIs (MediaDevices, AudioContext, AnalyserNode, Canvas 2D). No third-party libraries. Works in Chrome, Edge, and Firefox on desktop and mobile.
